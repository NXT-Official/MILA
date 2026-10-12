import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { aiChatCompletion, aiFailure } from "@/lib/ai.server";
import { consumeRateLimit, RateLimitExceededError } from "@/lib/rate-limit.server";
import { withAiCredit } from "@/lib/credits.server";
import {
  GENERATION_DEADLINE_SECONDS,
  resolveDailyAllowance,
  withGenerationJob,
  withJobId,
  type GenerationJobDeps,
  type GenerationJobRunning,
  type GenerationWriteGuard,
} from "@/lib/generation-jobs.server";
import { truncateWithEllipsis } from "@/lib/concierge-title";
import { AiUnavailableError, DomainValidationError } from "@/server/http/api-errors";
import { assertTrustedStorageImageUrl } from "@/lib/trusted-image-url.server";
import { isAvailableInRegion, isGenderMatch } from "@/lib/look-products.functions";
import type { ClothingAttributes } from "@/lib/outfit-items";
import {
  CLOTHING_CATEGORIES as CATEGORIES,
  CLOTHING_UNDERTONES as UNDERTONES,
} from "@/constants/wardrobe";
import type {
  DupeHuntResult,
  DupeMatch,
  FindDupesInputData,
  FindSimilarItemsInputData,
} from "@/lib/dupe-hunter.functions";
import {
  CLOSURES,
  DupeAttributesSchema,
  FORMALITIES,
  GARMENT_LENGTHS,
  GARMENT_TYPES,
  GENDER_FITS,
  MATCH_QUALITIES,
  PATTERNS,
  parseDupeAttributes,
  type DupeAttributes,
  type MatchQuality,
} from "@/lib/dupe-spec";
import {
  describeIdentification,
  garmentNoun,
  isPluralGarmentNoun,
  judgeCandidate,
  resolveDupeTarget,
  IDENTICAL_SIMILARITY,
  MIN_DUPE_SIMILARITY,
} from "./dupe-match";

type MilaSupabaseClient = SupabaseClient<Database>;

/**
 * MIN_DUPE_SIMILARITY (50, calibrated 2026-10-08) and IDENTICAL_SIMILARITY
 * (90) live with the matcher (dupe-match.ts), which caps unconfirmed matches
 * just under the threshold; they are re-exported here for existing importers.
 */
export { IDENTICAL_SIMILARITY, MIN_DUPE_SIMILARITY };

/** Ranking nudge for a match in the member's budget tier, on the 0-100
 * similarity scale: it orders equally close pieces, it never lifts a weaker
 * match over a clearly closer one. */
const BUDGET_RANK_NUDGE = 5;

/** The budget-related subset of SHOPPING_PREFERENCE_TAGS (see
 * src/constants/style-profile/questions.ts) — collected at onboarding into
 * profiles.shopping_preferences but never previously read back downstream. */
export const BUDGET_TAGS = ["Budget-Conscious", "Mid-Range", "Investment Pieces"] as const;

/** Children's and baby wording in a product TITLE (from airaDev's MM2 fix,
 * adapted): the catalogue has no age column and kids' rows are tagged Unisex,
 * so the gender filter lets them through ("Baby Fluffy Yarn Fleece Full-Zip
 * Jacket" in a women's coat hunt). Title only — store-wide descriptions like
 * Uniqlo's "clothes for women, men, kids and babies" sit on adult rows too.
 * Adult wording is left alone: "baby blue/pink", "baby tee", "baby cashmere",
 * "babydoll", "kid leather", "boyfriend". */
const KIDS_TITLE =
  /\b(?:kids|toddlers?|infants?|newborns?|babies|girls|boys|child|children|childrens|junior|juniors|youth)\b|\bbaby\b(?!\s*(?:blue|pink|yellow|lilac|lavender|green|doll|tee|t-shirt|cashmere|alpaca|rib|ribbed|cable))/i;

export function isKidsCatalogItem(title: string): boolean {
  return KIDS_TITLE.test(title);
}
export type BudgetTag = (typeof BUDGET_TAGS)[number];

/** Pulls the budget tag out of the profile's shopping_preferences tag array,
 * or null when none is set. Onboarding's tag select is multi-select, not
 * mutually exclusive, so if more than one budget tag was ever saved this
 * deterministically takes the first found. */
export function extractBudgetTag(shoppingPreferences: unknown): BudgetTag | null {
  if (!Array.isArray(shoppingPreferences)) return null;
  for (const tag of shoppingPreferences) {
    if (typeof tag === "string" && (BUDGET_TAGS as readonly string[]).includes(tag)) {
      return tag as BudgetTag;
    }
  }
  return null;
}

type PriceTier = "low" | "mid" | "high";

const BUDGET_TARGET_TIER: Record<BudgetTag, PriceTier> = {
  "Budget-Conscious": "low",
  "Mid-Range": "mid",
  "Investment Pieces": "high",
};

/** Score bonus for a candidate whose price tier matches the user's budget
 * tag — enough to nudge ranking without ever overriding a real attribute
 * mismatch, since it's only ever added on top of a candidate that already
 * scored above 0 on category/silhouette/color/palette match. */
const BUDGET_TIER_BONUS = 15;

/**
 * Which price tier `price` falls into, relative to `prices` — THIS search's
 * candidate set, never a hardcoded cross-currency threshold. Splits into
 * terciles by sorted position so "budget" always means "cheaper than most
 * of what's actually on offer for this garment" regardless of category or
 * currency.
 */
export function priceTier(prices: number[], price: number): PriceTier {
  const sorted = [...prices].sort((a, b) => a - b);
  const lowMax = sorted[Math.floor((sorted.length - 1) / 3)];
  const midMax = sorted[Math.floor((2 * (sorted.length - 1)) / 3)];
  if (price <= lowMax) return "low";
  if (price <= midMax) return "mid";
  return "high";
}

const tool = {
  function: {
    name: "report_clothing_attributes",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Vivid luxury descriptor, e.g. 'cream quilted top-handle vanity case'.",
        },
        category: {
          type: "string",
          enum: CATEGORIES as unknown as string[],
          description:
            "Bags for handbags, totes and backpacks; Jewelry for necklaces, earrings, bracelets and rings; Accessories only for belts, hats, scarves and socks.",
        },
        primary_color: { type: "string" },
        color_undertone: { type: "string", enum: UNDERTONES as unknown as string[] },
        silhouette_tags: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "string" },
          description: "Structural shape/construction cues the dupe must match.",
        },
        garment_type: {
          type: "string",
          enum: GARMENT_TYPES as unknown as string[],
          description:
            "The precise kind (subtype) of garment. coat: a tailored or structured outer layer cut longer than the hip (overcoat, wool coat, wrap coat, car coat). trench coat: a belted trench or mac. blazer: a tailored jacket with lapels. jacket: a casual hip-length jacket (bomber, shirt jacket, chore). athletic jacket: track jacket, windbreaker, fleece or any sports layer. puffer: down, padded or quilted. Never call a tailored coat a jacket.",
        },
        gender_fit: {
          type: "string",
          enum: GENDER_FITS as unknown as string[],
          description:
            "The department it is cut for (womenswear, menswear), from the cut, buttoning, proportions and styling. unisex only when it genuinely reads as either.",
        },
        formality: {
          type: "string",
          enum: FORMALITIES as unknown as string[],
          description:
            "Formality and occasion. formal: tailoring, suiting, wool or cashmere coats with lapels, office or evening wear. smart: polished but relaxed, smart casual. casual: everyday. athletic: sportswear, training, technical or gym pieces. not applicable: jewellery, bags and accessories.",
        },
        closure: {
          type: "string",
          enum: CLOSURES as unknown as string[],
          description:
            "How it fastens. double-breasted / single-breasted for buttoned tailoring, zip, belted (wrap or tie belt), toggle, snap, pullover (no opening), open front. not applicable for bags, jewellery, shoes.",
        },
        pattern: {
          type: "string",
          enum: PATTERNS as unknown as string[],
          description: "The surface pattern. Pinstripes and stripes are striped; checks are plaid.",
        },
        colors: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: { type: "string" },
          description:
            "Common colour words, dominant first, e.g. ['navy', 'white'] for navy with white stripes.",
        },
        length: {
          type: "string",
          enum: GARMENT_LENGTHS as unknown as string[],
          description:
            "Where the hem falls on the body; not applicable for bags, jewellery, shoes.",
        },
        fabric: {
          type: "string",
          description: "The main fabric as it looks, e.g. 'wool blend', 'cotton twill', 'nylon'.",
        },
        key_details: {
          type: "array",
          maxItems: 5,
          items: { type: "string" },
          description:
            "Visible construction details a true dupe must share, e.g. 'notch lapels', 'double-breasted', 'belted waist', 'gold buttons', 'flap pockets'.",
        },
      },
      required: [
        "name",
        "category",
        "primary_color",
        "color_undertone",
        "silhouette_tags",
        "garment_type",
        "gender_fit",
        "formality",
        "closure",
        "pattern",
        "colors",
        "length",
        "fabric",
        "key_details",
      ],
      additionalProperties: false,
    },
  },
};

/** Appended to the extraction's original system prompt: the structured read
 * the strict matcher filters on. */
const EXTRACTION_SPEC_PROMPT =
  "First identify exactly what the piece is: report the precise garment_type, the department it is cut for (gender_fit), its formality and occasion, how it fastens (closure), its pattern, its colours, its length, its fabric and its key construction details. The member wants a piece that looks the same, so be precise: a tailored coat, a trench coat, a blazer, a casual jacket and a sports jacket are different garments, and pinstripes are not plain. Length decides the kind: a tailored piece cut well below the hip is a coat; a soft or padded piece ending at or above the hip is a jacket (quilted pad jackets included), never a coat; a belted rain style is a trench coat. fabric is 1-2 words ('wool blend', 'quilted cotton'), not a sentence.";

function scoreCandidate(
  inspiration: ClothingAttributes,
  product: {
    title: string;
    description: string | null;
    category: string;
    seasonal_palettes: string[];
  },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (product.category.toLowerCase() === inspiration.category.toLowerCase()) {
    score += 40;
    reasons.push(`Same category (${product.category})`);
  }

  const haystack = `${product.title} ${product.description ?? ""}`.toLowerCase();

  let silhouetteHits = 0;
  for (const tag of inspiration.silhouette_tags) {
    if (haystack.includes(tag.toLowerCase())) {
      silhouetteHits += 1;
      reasons.push(`Matches "${tag}"`);
    }
  }
  score += silhouetteHits * 15;

  if (haystack.includes(inspiration.primary_color.toLowerCase())) {
    score += 20;
    reasons.push(`Shares ${inspiration.primary_color} color`);
  }

  const undertoneMap: Record<string, string[]> = {
    Warm: ["spring", "autumn"],
    Cool: ["summer", "winter"],
    Neutral: ["spring", "summer", "autumn", "winter"],
  };
  const undertoneFamilies = undertoneMap[inspiration.color_undertone] ?? [];
  const paletteHit = product.seasonal_palettes.some((p) =>
    undertoneFamilies.some((fam) => p.toLowerCase().includes(fam)),
  );
  if (paletteHit) {
    score += 10;
    reasons.push(`${inspiration.color_undertone} undertone fit`);
  }

  return { score, reasons };
}

const PRODUCT_COLUMNS =
  "id,title,description,category,price,currency,image_url,affiliate_link,brand_id,seasonal_palettes,available_regions,in_stock,verification_status,last_verified_at,rating,units_sold,shipping_info,discount_percent,brands(is_verified_seller)";

/** Column sets tried in order. `gender` and `attire` feed the strict matcher;
 * a database that predates either column (attire: migration
 * 20261005105000) still answers the plain query, and the matcher reads
 * gender and formality from the copy instead. */
const CATALOGUE_COLUMN_SETS = [
  `${PRODUCT_COLUMNS},gender,attire`,
  `${PRODUCT_COLUMNS},gender`,
  PRODUCT_COLUMNS,
];

/** PostgREST answers a select of a column that does not exist with the
 * Postgres undefined_column code. */
const UNDEFINED_COLUMN = "42703";

type CatalogueRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  price: number;
  currency: string;
  image_url: string | null;
  affiliate_link: string;
  brand_id: string;
  seasonal_palettes: string[];
  available_regions: string[];
  in_stock: boolean;
  verification_status: string;
  last_verified_at: string | null;
  rating: number | null;
  units_sold: number | null;
  shipping_info: string | null;
  discount_percent: number | null;
  brands: { is_verified_seller: boolean } | null;
  gender?: string | null;
  attire?: string[] | null;
};

async function queryCatalogue(
  supabase: MilaSupabaseClient,
  category: string,
): Promise<CatalogueRow[]> {
  let lastError: unknown = null;
  for (const columns of CATALOGUE_COLUMN_SETS) {
    const { data, error } = (await supabase
      .from("products")
      .select(columns)
      .ilike("category", category)
      .neq("verification_status", "broken")
      .eq("in_stock", true)
      .limit(200)) as unknown as {
      data: CatalogueRow[] | null;
      error: { code?: string; message?: string } | null;
    };
    if (!error) return data ?? [];
    lastError = error;
    if (error.code !== UNDEFINED_COLUMN) break;
  }
  console.error("Product query failed", lastError);
  throw new Error("Couldn't search the dupe catalog.");
}

/** A catalogue row that passed the strict matcher, with both scores and
 * whether the member's own filters keep it. */
type ScoredCandidate = {
  product: CatalogueRow;
  /** 0-100, from the strict matcher (dupe-match.ts). */
  similarity: number;
  summary: string;
  /** The original additive score and its reasons (scoreCandidate). */
  legacyScore: number;
  legacyReasons: string[];
  /** Ships to the member's region (client-supplied `region`). */
  withinRegion: boolean;
  /** At or under the member's price ceiling (client-supplied `maxBudget`). */
  withinBudget: boolean;
};

type ShownCandidate = ScoredCandidate & { matchReason: string };

/**
 * Every catalogue row in the inspiration's category with a shop link that
 * scores above 0 on the original attribute score AND survives the strict
 * matcher: same garment kind (or a related one), a compatible department, a
 * formality no more than one step away, and no pattern conflict. Sorted
 * closest first.
 *
 * The member's own filters (region, price ceiling) are recorded on each row,
 * not applied here: the hunt needs to know whether the CATALOGUE had a close
 * match before her filters, so an empty result she caused herself is never
 * refunded (see findDupesForUser). rankDupes applies them.
 *
 * Sharing the category no longer makes a row a match. The original score's
 * +40 for the same category still makes `legacy.score` positive for every
 * row the query returns, so that check never decides anything now; what
 * decides is the strict matcher, where category earns no similarity points,
 * and the MIN_DUPE_SIMILARITY threshold.
 *
 * `genderDirection` (the member's direction, see resolveGenderDirection)
 * narrows the candidates BEFORE scoring: a woman is never shown a men's
 * piece, a man never a women's; Unisex rows are always eligible. A row whose
 * catalogue has no gender column yet is left to the strict matcher.
 */
async function scoreDupeCandidates(
  supabase: MilaSupabaseClient,
  inspiration: DupeAttributes,
  region: string | undefined,
  maxBudget: number | null | undefined,
  profileGender: string | null | undefined,
  genderDirection?: "Male" | "Female",
): Promise<ScoredCandidate[]> {
  const rows = await queryCatalogue(supabase, inspiration.category);
  const target = resolveDupeTarget(inspiration, profileGender);

  const scored: ScoredCandidate[] = [];
  for (const product of rows) {
    if (!product.affiliate_link) continue;
    // Children's wear never matches a member's hunt, however close the piece
    // reads (the catalogue's "Baby Fluffy Yarn Fleece Full-Zip Jacket" is a
    // real Unisex Outerwear row).
    if (isKidsCatalogItem(product.title)) continue;
    if (product.gender != null && !isGenderMatch(product.gender, undefined, genderDirection)) {
      continue;
    }
    const legacy = scoreCandidate(inspiration, product);
    if (legacy.score <= 0) continue;
    const verdict = judgeCandidate(target, product);
    if (!verdict.eligible) continue;
    scored.push({
      product,
      similarity: verdict.similarity,
      summary: verdict.summary,
      legacyScore: legacy.score,
      legacyReasons: legacy.reasons,
      withinRegion: isAvailableInRegion(product, region),
      withinBudget: maxBudget == null || product.price <= maxBudget,
    });
  }
  return scored.sort((a, b) => b.similarity - a.similarity || a.product.price - b.product.price);
}

/** The rows the member's own filters keep: shipped to her region, within
 * her price ceiling. */
function withinMemberFilters(scored: ScoredCandidate[]): ScoredCandidate[] {
  return scored.filter((c) => c.withinRegion && c.withinBudget);
}

/** Thresholded, ordered, capped matches from an already-scored set. */
function matchesFrom(
  scored: ScoredCandidate[],
  maxResults: number,
  budgetTag: BudgetTag | null,
  minSimilarity: number,
): DupeMatch[] {
  const eligible = withinMemberFilters(scored);
  const shown = eligible
    .filter((c) => c.similarity >= minSimilarity)
    .map((c) => ({ ...c, matchReason: c.summary }));
  return toDupeMatches(
    shown,
    maxResults,
    budgetTag,
    eligible.map((c) => c.product.price),
  );
}

/**
 * Orders, caps and shapes the pieces to show. The budget tier is relative to
 * `tierPrices`, THIS search's candidate set. `match_score` and
 * `match_reasons` keep their original meaning (additive score plus the
 * budget bonus); the closest-match line leads `match_reasons` so clients
 * that only show the first reason show the right one.
 */
function toDupeMatches(
  shown: ShownCandidate[],
  maxResults: number,
  budgetTag: BudgetTag | null,
  tierPrices: number[],
): DupeMatch[] {
  const targetTier = budgetTag ? BUDGET_TARGET_TIER[budgetTag] : null;
  const rankKey = (c: ShownCandidate, fitsBudget: boolean) =>
    c.similarity + (fitsBudget ? BUDGET_RANK_NUDGE : 0);

  return shown
    .map((c) => ({
      c,
      fitsBudget: !!targetTier && priceTier(tierPrices, c.product.price) === targetTier,
    }))
    .sort((a, b) => {
      const diff = rankKey(b.c, b.fitsBudget) - rankKey(a.c, a.fitsBudget);
      if (diff !== 0) return diff;
      return a.c.product.price - b.c.product.price;
    })
    .slice(0, maxResults)
    .map(({ c, fitsBudget }) => {
      const { product } = c;
      return {
        id: product.id,
        title: product.title,
        brand_id: product.brand_id,
        category: product.category,
        price: product.price,
        currency: product.currency,
        image_url: product.image_url,
        affiliate_link: product.affiliate_link,
        description: product.description,
        match_score: c.legacyScore + (fitsBudget ? BUDGET_TIER_BONUS : 0),
        match_reasons: [
          c.matchReason,
          ...c.legacyReasons,
          ...(fitsBudget ? [`Fits your ${budgetTag} budget`] : []),
        ],
        verification_status: product.verification_status,
        last_verified_at: product.last_verified_at,
        rating: product.rating,
        units_sold: product.units_sold,
        shipping_info: product.shipping_info,
        discount_percent: product.discount_percent,
        is_verified_seller: product.brands?.is_verified_seller ?? false,
        similarity: c.similarity,
        matchReason: c.matchReason,
      };
    });
}

/**
 * The ONE catalog direction this member's dupes may come from. A stated
 * Male/Female filters to exactly that direction — a woman is never shown a
 * men's piece, a man never a women's. Unknown / Non-binary /
 * Prefer-not-to-say resolves to a single direction decided per hunt, so a
 * result list still can't mix menswear and womenswear. This mirrors the look
 * pipeline's rule (generateLookForUser's fallbackGenderDirection in
 * src/server/services/look.ts) so both engines treat the catalog identically.
 * Unisex pieces are always eligible, whichever direction wins — see
 * isGenderMatch (src/lib/look-products.functions.ts).
 *
 * When her profile doesn't say, the piece she photographed decides before any
 * coin toss: a member hunting a womenswear coat gets womenswear (plus Unisex),
 * never a random menswear list that hides every close match.
 */
export function resolveGenderDirection(
  profileGender: string | null | undefined,
  pieceGenderFit?: string | null,
): "Male" | "Female" {
  if (profileGender === "Male" || profileGender === "Female") return profileGender;
  if (pieceGenderFit === "womenswear") return "Female";
  if (pieceGenderFit === "menswear") return "Male";
  return Math.random() < 0.5 ? "Male" : "Female";
}

export type RankDupesOptions = {
  /** The member's profile gender ("Male" | "Female"; anything else means
   * unknown). Used when the garment's own fit is unisex or unknown. */
  gender?: string | null;
  /** The member's catalog direction (resolveGenderDirection): candidates of
   * the other direction are dropped before scoring; Unisex always stays. */
  genderDirection?: "Male" | "Female";
  /** Minimum 0-100 similarity to show. Defaults to MIN_DUPE_SIMILARITY. */
  minSimilarity?: number;
};

/**
 * Attributes in, ranked catalog matches out. No vision, no credit — the drawer
 * already has the attributes stored on the post item. Shared by
 * `findSimilarItemsForUser` and `findDupesForUser` so the same garment ranks
 * identically whichever path reached it.
 *
 * `budgetTag` (from the user's profile, see extractBudgetTag) never widens
 * or narrows the result set — it only re-ranks among candidates that already
 * matched the inspiration piece on category/silhouette/color/palette.
 *
 * `maxBudget`, in contrast, is a hard price ceiling the user typed in for
 * this search — anything priced above it is never shown, not just
 * re-ranked. Since 2026-10-07 it (and `region`) is applied after scoring, in
 * matchesFrom, so the hunt can tell "nothing close in the catalogue" from
 * "her filters hid the close ones" (see findDupesForUser).
 *
 * Strict matching (2026-10-07): a candidate must also be the same garment
 * kind, fit the same department, sit within one formality step, not
 * contradict the pattern, and reach `options.minSimilarity` (default
 * MIN_DUPE_SIMILARITY). Fewer results, or none, beat unrelated ones.
 */
export async function rankDupes(
  supabase: MilaSupabaseClient,
  inspiration: DupeAttributes,
  maxResults: number,
  region?: string,
  budgetTag: BudgetTag | null = null,
  maxBudget?: number | null,
  options: RankDupesOptions = {},
): Promise<DupeMatch[]> {
  const scored = await scoreDupeCandidates(
    supabase,
    inspiration,
    region,
    maxBudget,
    options.gender,
    options.genderDirection,
  );
  return matchesFrom(scored, maxResults, budgetTag, options.minSimilarity ?? MIN_DUPE_SIMILARITY);
}

/**
 * Similar catalogue pieces for a garment Mila already catalogued on a post.
 * **Free, no AI call** — the attributes were extracted when the post was
 * analysed, so this is a catalogue query. Shared verbatim by the web
 * `findSimilarItems` server function and the mobile
 * `POST /api/v1/dupes/similar` route.
 */
export async function findSimilarItemsForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: FindSimilarItemsInputData,
): Promise<DupeMatch[]> {
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("shopping_preferences,gender")
    .eq("id", userId)
    .maybeSingle();
  const budgetTag = extractBudgetTag(profileRow?.shopping_preferences);
  return rankDupes(
    supabase,
    data.attributes,
    data.maxResults,
    data.region,
    budgetTag,
    data.maxBudget,
    {
      gender: profileRow?.gender,
      genderDirection: resolveGenderDirection(profileRow?.gender, data.attributes.gender_fit),
    },
  );
}
/** Member-facing line when close matches exist but her own filters hid them. */
function hiddenByFiltersMessage(aboveBudget: boolean, outsideRegion: boolean): string {
  if (aboveBudget && outsideRegion) {
    return "Close matches exist above your budget or outside your region.";
  }
  if (aboveBudget) return "Close matches exist above your budget.";
  return "Close matches exist outside your region.";
}

/**
 * The hunt's overall verdict, the identification in one line, and a calm
 * message when nothing is shown. `closeInCatalogue` is every row at or above
 * the threshold BEFORE her region and budget filters: when those exist but
 * none is shown, her filters hid them, and the message says so.
 */
function huntResult(
  inspiration: DupeAttributes,
  dupes: DupeMatch[],
  closeInCatalogue: ScoredCandidate[],
): DupeHuntResult {
  const identifiedAs = describeIdentification(inspiration);
  if (dupes.length === 0 && closeInCatalogue.length > 0) {
    const aboveBudget = closeInCatalogue.some((c) => !c.withinBudget);
    const outsideRegion = closeInCatalogue.some((c) => !c.withinRegion);
    return {
      inspiration,
      dupes,
      identifiedAs,
      matchQuality: "none",
      message: hiddenByFiltersMessage(aboveBudget, outsideRegion),
      hiddenByFilters: { aboveBudget, outsideRegion },
    };
  }
  if (dupes.length === 0) {
    const noun = garmentNoun(inspiration);
    const determiner = isPluralGarmentNoun(noun) ? "these" : "this";
    return {
      inspiration,
      dupes,
      identifiedAs,
      matchQuality: "none",
      message: `Nothing in our catalogue is close enough to ${determiner} ${noun} yet.`,
    };
  }
  const best = Math.max(...dupes.map((d) => d.similarity ?? 0));
  const matchQuality: MatchQuality = best >= IDENTICAL_SIMILARITY ? "identical" : "close";
  return { inspiration, dupes, identifiedAs, matchQuality };
}

/** Injectable for tests; production uses the real AI, credit, rate-limit and
 * generation-job modules. */
export type FindDupesDeps = {
  aiChatCompletion: typeof aiChatCompletion;
  /** Today's credit wrapper: the whole charge while the generation_jobs
   * migration is not applied (the job charges once at start otherwise). */
  withAiCredit: typeof withAiCredit;
  consumeRateLimit: typeof consumeRateLimit;
  /** The generation-job seams (store, availability, clock). Absent: no job
   * is started and the hunt runs today's withAiCredit path, which is what a
   * deps object written before jobs gets. The production default sets it. */
  jobs?: GenerationJobDeps;
  /** The daily allowance the job's charge is taken against. */
  dailyAllowance?: (supabase: MilaSupabaseClient, userId: string) => Promise<number>;
  /** The job deadline in seconds. Tests shorten it; production uses the
   * route maximum. */
  deadlineSeconds?: number;
};

const defaultFindDupesDeps: FindDupesDeps = {
  aiChatCompletion,
  withAiCredit,
  consumeRateLimit,
  jobs: {},
  dailyAllowance: resolveDailyAllowance,
};

/** At most this many refunded (empty) hunts per member per day. Past it an
 * empty hunt is charged like any other, with no error: the cap bounds how
 * many hunts a day are refunded. */
const REFUND_CAP = { limit: 3, windowSeconds: 86_400 };

/**
 * Claims one of the member's refunds for today. False (charge as normal)
 * when the cap is used up, and also when the cap cannot be checked: a refund
 * is only granted when it is known to be within the cap.
 */
async function claimRefund(deps: FindDupesDeps, userId: string): Promise<boolean> {
  try {
    await deps.consumeRateLimit(`ai:findDupes:refund:${userId}`, REFUND_CAP);
    return true;
  } catch (err) {
    if (!(err instanceof RateLimitExceededError)) {
      console.error("[findDupes] refund cap check failed; charging as normal", err);
    }
    return false;
  }
}

/** What the credit wrapper sees: the hunt, and whether to refund it. */
type HuntOutcome = { hunt: DupeHuntResult; refundable: boolean };

/** The job error code of a hunt refunded because nothing in the catalogue
 * was close. Its failed row keeps the hunt she was shown. */
const NO_CLOSE_MATCH = "no_close_match";

const EXTRACTION_FAILED_MESSAGE = "Dupe extraction failed.";
/** The vision read did not parse: calm copy, never validation text. */
const UNREADABLE_PIECE_MESSAGE = "Mila couldn't read that piece. Please try a clearer photo.";
/** A refunded hunt whose details were not kept on its row
 * (20261008100000_generation_job_fail_with_result.sql not applied yet). */
const REFUNDED_NOTHING_CLOSE_MESSAGE =
  "Nothing in our catalogue was close enough to your piece. Your credit is back.";

/** Each stored match description is cut to this many characters (with "…"),
 * so 20 matches stay far inside a job row's 64 KB. The live answer is not
 * cut. */
const STORED_DESCRIPTION_MAX = 500;

/** The vision read as attributes. A read that does not parse is answered with
 * calm copy (and refunded by the job or withAiCredit, as any throw is). */
function readInspiration(args: unknown): DupeAttributes {
  try {
    return parseDupeAttributes(args);
  } catch (err) {
    console.error("[findDupes] the vision read did not parse", err);
    throw new AiUnavailableError(UNREADABLE_PIECE_MESSAGE);
  }
}

/** The answer she is shown: the hunt, saying so when its credit came back. */
function answerFor({ hunt, refundable }: HuntOutcome): DupeHuntResult {
  return refundable ? { ...hunt, creditRefunded: true } : hunt;
}

/**
 * The hunt as its job row keeps it: exactly what she was shown, without the
 * jobId, each description cut to STORED_DESCRIPTION_MAX. The cut backs off to
 * a character boundary: a split surrogate pair would make jsonb refuse the
 * row.
 */
function toStoredHunt(hunt: DupeHuntResult): Json {
  const stored: Record<string, unknown> = {
    inspiration: hunt.inspiration,
    dupes: hunt.dupes.map((match) => ({
      ...match,
      description:
        typeof match.description === "string"
          ? truncateWithEllipsis(match.description, STORED_DESCRIPTION_MAX)
          : match.description,
    })),
    identifiedAs: hunt.identifiedAs,
    matchQuality: hunt.matchQuality,
    message: hunt.message,
    hiddenByFilters: hunt.hiddenByFilters,
    creditRefunded: hunt.creditRefunded,
  };
  // An optional field she was not shown is not written at all.
  return Object.fromEntries(
    Object.entries(stored).filter(([, value]) => value !== undefined),
  ) as unknown as Json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A stored match is trusted only with the fields every client reads. */
function isStoredMatch(value: unknown): value is DupeMatch {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.affiliate_link === "string" &&
    typeof value.price === "number" &&
    typeof value.currency === "string" &&
    Array.isArray(value.match_reasons)
  );
}

function isMatchQuality(value: unknown): value is MatchQuality {
  return typeof value === "string" && (MATCH_QUALITIES as readonly string[]).includes(value);
}

/** A hunt read back from its job row, checked before it is trusted, with
 * exactly the fields a hunt answers. Null when it does not validate. */
function huntFromStored(result: Json | null): DupeHuntResult | null {
  if (!isRecord(result)) return null;
  const inspiration = DupeAttributesSchema.safeParse(result.inspiration);
  const dupes: unknown = result.dupes;
  if (!inspiration.success || !Array.isArray(dupes) || !dupes.every(isStoredMatch)) return null;
  const hunt: DupeHuntResult = { inspiration: inspiration.data, dupes };
  if (typeof result.identifiedAs === "string") hunt.identifiedAs = result.identifiedAs;
  if (isMatchQuality(result.matchQuality)) hunt.matchQuality = result.matchQuality;
  if (typeof result.message === "string") hunt.message = result.message;
  const hidden = result.hiddenByFilters;
  if (
    isRecord(hidden) &&
    typeof hidden.aboveBudget === "boolean" &&
    typeof hidden.outsideRegion === "boolean"
  ) {
    hunt.hiddenByFilters = { aboveBudget: hidden.aboveBudget, outsideRegion: hidden.outsideRegion };
  }
  if (result.creditRefunded === true) hunt.creditRefunded = true;
  return hunt;
}

/**
 * The vision half of the pair: extracts structural attributes from an
 * inspiration piece, then ranks real catalogue rows against them.
 * **1 AI credit**, 15/hour. `imageUrl` must already be a Mila storage URL —
 * the server rejects anything else, because handing a server-side fetch a
 * client-supplied URL is a server-side request forgery primitive (§8).
 *
 * Accuracy fix (2026-10-07), same method and still ONE AI call: the vision
 * read first identifies the piece precisely (garment kind, department,
 * formality, closure, pattern, colours, length, fabric, details), and the
 * catalogue ranking rules out every row that contradicts it before scoring
 * (see rankDupes). Only pieces at or above MIN_DUPE_SIMILARITY come back.
 *
 * **Refunds**: the credit is refunded only when the CATALOGUE has nothing
 * close, judged before her own region and price filters, and at most
 * REFUND_CAP times a day. When close matches exist but her filters hid them
 * she is charged (she got the identification and a real answer), and the
 * message says what hid them. Her own filters therefore never decide whether
 * a hunt is refunded.
 *
 * Shared verbatim by the web `findDupes` server function and the mobile
 * `POST /api/v1/dupes/find` route. Results honor the hunter's gender — a
 * woman's hunt never surfaces a men's piece (resolveGenderDirection).
 *
 * **Runs as a generation job** (src/lib/generation-jobs.server.ts), so a hunt
 * survives her leaving: the credit is taken when the job starts, the hunt she
 * is shown is kept on its job row before she is answered, and a repeated
 * `clientRequestId` replays it without a second charge or AI call. A hunt with
 * nothing close is refunded through the job, exactly once, and its failed row
 * (`no_close_match`) still keeps what Mila identified; the answer says
 * `creditRefunded: true`. `inFlight: 'report'` answers `{ status: 'running',
 * jobId }` while another hunt is in flight. The matching method is unchanged.
 * Until the migration is applied this is exactly the old `withAiCredit` path
 * (plus `creditRefunded` on a refunded hunt).
 */
export function findDupesForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: FindDupesInputData,
  deps?: FindDupesDeps,
  options?: { inFlight?: "attach" },
): Promise<DupeHuntResult>;
export function findDupesForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: FindDupesInputData,
  deps: FindDupesDeps | undefined,
  options: { inFlight: "report" },
): Promise<DupeHuntResult | GenerationJobRunning>;
export async function findDupesForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: FindDupesInputData,
  deps: FindDupesDeps = defaultFindDupesDeps,
  options: { inFlight?: "attach" | "report" } = {},
): Promise<DupeHuntResult | GenerationJobRunning> {
  await deps.consumeRateLimit(`ai:findDupes:${userId}`, { limit: 15, windowSeconds: 3600 });
  // Validation that needs no AI runs before any charge, so a refused image is
  // never charged (on either path).
  const imageUrl = assertTrustedStorageImageUrl(data.imageUrl);

  // src: src/lib/generation-jobs.server.ts (GenerationWriteGuard) · P2B-S0 (e271b5c)
  // The refund-slot claim is this hunt's one side effect, so it is its last
  // step and asks stillRunning() right before it. A yes marks the claim as
  // under way: at the deadline the wrapper's write grace waits for it, so the
  // slot and the job's refund settle together (no_close_match). A no (past the
  // produce deadline, the row no longer running, or unreadable) claims
  // nothing: the wrapper's deadline path refunds the job, and she keeps her
  // daily refunds; an unreadable row charges the hunt, fail closed like
  // claimRefund. Always yes on the legacy path (today's behaviour).
  // aiChatCompletion takes no abort signal, so the AI call itself runs on.
  const runHunt = async ({ stillRunning }: GenerationWriteGuard): Promise<HuntOutcome> => {
    const systemPrompt =
      "You are Mila — an elite luxury fashion archivist. Look at the inspiration piece in the image (likely high-end designer) and extract precise structural silhouette and color attributes so we can match budget dupes. silhouette_tags must isolate the SHAPE/CONSTRUCTION cues a dupe must match. Report the piece the photo actually shows, and give name a short real descriptor of it (never placeholder text). Always call the report_clothing_attributes tool.";

    const result = await deps.aiChatCompletion(
      [
        { role: "system", content: `${systemPrompt} ${EXTRACTION_SPEC_PROMPT}` },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the structural attributes for dupe hunting." },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      tool,
      { supabase, userId },
    );
    if (!result.ok) throw aiFailure(result.status, EXTRACTION_FAILED_MESSAGE);

    const inspiration = readInspiration(result.args);
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("shopping_preferences,gender")
      .eq("id", userId)
      .maybeSingle();
    const budgetTag = extractBudgetTag(profileRow?.shopping_preferences);

    // Same scoring and threshold as rankDupes, kept in hand so the
    // pre-filter set can decide the refund.
    const scored = await scoreDupeCandidates(
      supabase,
      inspiration,
      data.region,
      data.maxBudget,
      profileRow?.gender,
      resolveGenderDirection(profileRow?.gender, inspiration.gender_fit),
    );
    const dupes = matchesFrom(scored, data.maxResults, budgetTag, MIN_DUPE_SIMILARITY);
    const closeInCatalogue = scored.filter((c) => c.similarity >= MIN_DUPE_SIMILARITY);

    const hunt = huntResult(inspiration, dupes, closeInCatalogue);
    const refundable =
      closeInCatalogue.length === 0 && (await stillRunning()) && (await claimRefund(deps, userId));
    return { hunt, refundable };
  };

  // Today's path: one credit through withAiCredit, refunded when the hunt
  // says so.
  const legacy = async (guard: GenerationWriteGuard): Promise<DupeHuntResult> =>
    answerFor(
      await deps.withAiCredit(supabase, userId, () => runHunt(guard), {
        // Nothing close in the whole catalogue means no value delivered: don't
        // charge for it (within the daily refund cap).
        refundIf: (outcome) => outcome.refundable,
      }),
    );

  if (!deps.jobs) {
    // No job seams were given: today's path, with no job to check against.
    return legacy({ signal: new AbortController().signal, stillRunning: async () => true });
  }

  const outcome = await withGenerationJob<DupeHuntResult>(
    {
      kind: "dupe_search",
      userId,
      clientRequestId: data.clientRequestId,
      input: {
        imageUrl,
        maxResults: data.maxResults,
        region: data.region,
        maxBudget: data.maxBudget,
      },
      charge: true,
      dailyAllowance: await (deps.dailyAllowance ?? resolveDailyAllowance)(supabase, userId),
      deadlineSeconds: deps.deadlineSeconds ?? GENERATION_DEADLINE_SECONDS,
      inFlight: options.inFlight,
      // A hunt with nothing close was refunded (within the cap): the job fails
      // with a refund, keeping the hunt on its failed row. Anything else is
      // delivered and charged, filters-hid-them and cap-used-up included.
      settle: (hunt) =>
        hunt.creditRefunded === true
          ? { ok: false, errorCode: NO_CLOSE_MATCH, result: toStoredHunt(hunt) }
          : { ok: true, result: toStoredHunt(hunt) },
      fromStored: ({ result }) => {
        const stored = huntFromStored(result);
        if (!stored) {
          console.error("[findDupes] a stored hunt no longer validates");
          throw new Error(EXTRACTION_FAILED_MESSAGE);
        }
        return stored;
      },
      failure: (errorCode, stored) => {
        if (errorCode === NO_CLOSE_MATCH) {
          const kept = stored ? huntFromStored(stored.result) : null;
          if (kept) return kept;
          throw new DomainValidationError(REFUNDED_NOTHING_CLOSE_MESSAGE);
        }
        // A replay answers what she saw: the unreadable-photo copy for a read
        // that did not parse, today's extraction failure otherwise.
        if (errorCode === "AiUnavailableError") {
          throw new AiUnavailableError(UNREADABLE_PIECE_MESSAGE);
        }
        throw new Error(EXTRACTION_FAILED_MESSAGE);
      },
      legacy,
    },
    async (job) => answerFor(await runHunt(job)),
    deps.jobs,
  );
  return outcome.status === "running" ? outcome : withJobId(outcome.value, outcome.jobId);
}
