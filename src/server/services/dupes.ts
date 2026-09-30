import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aiChatCompletion, aiFailure } from "@/lib/ai.server";
import { consumeRateLimit } from "@/lib/rate-limit.server";
import { withAiCredit } from "@/lib/credits.server";
import { assertTrustedStorageImageUrl } from "@/lib/trusted-image-url.server";
import { isAvailableInRegion } from "@/lib/look-products.functions";
import { ClothingAttributesSchema, type ClothingAttributes } from "@/lib/outfit-items";
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

type MilaSupabaseClient = SupabaseClient<Database>;

/** The budget-related subset of SHOPPING_PREFERENCE_TAGS (see
 * src/constants/style-profile/questions.ts) — collected at onboarding into
 * profiles.shopping_preferences but never previously read back downstream. */
export const BUDGET_TAGS = ["Budget-Conscious", "Mid-Range", "Investment Pieces"] as const;
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
        category: { type: "string", enum: CATEGORIES as unknown as string[] },
        primary_color: { type: "string" },
        color_undertone: { type: "string", enum: UNDERTONES as unknown as string[] },
        silhouette_tags: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "string" },
          description: "Structural shape/construction cues the dupe must match.",
        },
      },
      required: ["name", "category", "primary_color", "color_undertone", "silhouette_tags"],
      additionalProperties: false,
    },
  },
};

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
 * this search — anything priced above it is dropped before scoring, not
 * just re-ranked.
 */
export async function rankDupes(
  supabase: MilaSupabaseClient,
  inspiration: ClothingAttributes,
  maxResults: number,
  region?: string,
  budgetTag: BudgetTag | null = null,
  maxBudget?: number | null,
): Promise<DupeMatch[]> {
  const { data: candidates, error } = await supabase
    .from("products")
    .select(
      "id,title,description,category,price,currency,image_url,affiliate_link,brand_id,seasonal_palettes,available_regions,in_stock,verification_status,last_verified_at,rating,units_sold,shipping_info,discount_percent,brands(is_verified_seller)",
    )
    .ilike("category", inspiration.category)
    .neq("verification_status", "broken")
    .eq("in_stock", true)
    .limit(200);

  if (error) {
    console.error("Product query failed", error);
    throw new Error("Couldn't search the dupe catalog.");
  }

  const relevant = (candidates ?? [])
    .filter(
      (p) =>
        !!p.affiliate_link &&
        isAvailableInRegion(p, region) &&
        (maxBudget == null || p.price <= maxBudget),
    )
    .map((product) => {
      const { score, reasons } = scoreCandidate(inspiration, product);
      return { product, score, reasons };
    })
    .filter((r) => r.score > 0);

  const targetTier = budgetTag ? BUDGET_TARGET_TIER[budgetTag] : null;
  const prices = relevant.map((r) => r.product.price);

  return relevant
    .map((r) => {
      if (!targetTier || priceTier(prices, r.product.price) !== targetTier) return r;
      return {
        ...r,
        score: r.score + BUDGET_TIER_BONUS,
        reasons: [...r.reasons, `Fits your ${budgetTag} budget`],
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.product.price - b.product.price;
    })
    .slice(0, maxResults)
    .map(({ product, score, reasons }) => ({
      id: product.id,
      title: product.title,
      brand_id: product.brand_id,
      category: product.category,
      price: product.price,
      currency: product.currency,
      image_url: product.image_url,
      affiliate_link: product.affiliate_link,
      description: product.description,
      match_score: score,
      match_reasons: reasons,
      verification_status: product.verification_status,
      last_verified_at: product.last_verified_at,
      rating: product.rating,
      units_sold: product.units_sold,
      shipping_info: product.shipping_info,
      discount_percent: product.discount_percent,
      is_verified_seller: product.brands?.is_verified_seller ?? false,
    }));
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
    .select("shopping_preferences")
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
  );
}

/**
 * The vision half of the pair: extracts structural attributes from an
 * inspiration piece, then ranks real catalogue rows against them.
 * **1 AI credit**, 15/hour. `imageUrl` must already be a Mila storage URL —
 * the server rejects anything else, because handing a server-side fetch a
 * client-supplied URL is a server-side request forgery primitive (§8).
 *
 * Shared verbatim by the web `findDupes` server function and the mobile
 * `POST /api/v1/dupes/find` route.
 */
export async function findDupesForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: FindDupesInputData,
): Promise<DupeHuntResult> {
  await consumeRateLimit(`ai:findDupes:${userId}`, { limit: 15, windowSeconds: 3600 });
  return withAiCredit(supabase, userId, async () => {
    const imageUrl = assertTrustedStorageImageUrl(data.imageUrl);

    const systemPrompt =
      "You are Mila — an elite luxury fashion archivist. Look at the inspiration piece in the image (likely high-end designer) and extract precise structural silhouette and color attributes so we can match budget dupes. silhouette_tags must isolate the SHAPE/CONSTRUCTION cues a dupe must match. Always call the report_clothing_attributes tool.";

    const result = await aiChatCompletion(
      [
        { role: "system", content: systemPrompt },
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
    if (!result.ok) throw aiFailure(result.status, "Dupe extraction failed.");

    const inspiration = ClothingAttributesSchema.parse(result.args);
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("shopping_preferences")
      .eq("id", userId)
      .maybeSingle();
    const budgetTag = extractBudgetTag(profileRow?.shopping_preferences);
    const dupes = await rankDupes(
      supabase,
      inspiration,
      data.maxResults,
      data.region,
      budgetTag,
      data.maxBudget,
    );
    return { inspiration, dupes };
  });
}
