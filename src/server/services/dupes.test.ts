import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  extractBudgetTag,
  findDupesForUser,
  findSimilarItemsForUser,
  priceTier,
  rankDupes,
  resolveGenderDirection,
  type FindDupesDeps,
} from "./dupes";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ClothingAttributes } from "@/lib/outfit-items";
import type { DupeAttributes } from "@/lib/dupe-spec";
import type { AiTool } from "@/lib/ai.server";
import { RateLimitExceededError, type RateLimitPolicy } from "@/lib/rate-limit.server";
import { createAvailabilityCache, type GenerationJobDeps } from "@/lib/generation-jobs.server";
import { AiUnavailableError, DomainValidationError } from "@/server/http/api-errors";
import type { DupeHuntResult } from "@/lib/dupe-hunter.functions";
import { MemoryGenerationJobStore } from "../../../tests/helpers/memory-generation-job-store";
import {
  MENS_COATS,
  OUTERWEAR_CATALOGUE,
  PINSTRIPE_COAT,
  SPORTY_OUTERWEAR,
  WOMENS_FORMAL_OUTERWEAR,
  REAL_TRENCHES,
  ZARA_CASE_CATALOGUE,
  ZARA_CASE_REAL_ROWS,
  ZARA_PLAIN_COAT,
  ZARA_PUFFER,
  ZARA_STRIPED_OVERCOAT,
  ZARA_TRACK_JACKET,
  type FixtureProductRow,
} from "./dupes.fixtures";

const INSPIRATION: ClothingAttributes = {
  name: "Quilted vanity case",
  category: "Accessories",
  primary_color: "Cream",
  color_undertone: "Warm",
  silhouette_tags: ["quilted", "top-handle"],
};

type ProductRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  gender: string;
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
};

function product(id: string, overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id,
    title: `Quilted ${id}`,
    description: "quilted top-handle case in cream.",
    category: "Accessories",
    gender: "Unisex",
    price: 100,
    currency: "USD",
    image_url: null,
    affiliate_link: `https://shop.example.com/${id}`,
    brand_id: "brand-1",
    seasonal_palettes: [],
    available_regions: [],
    in_stock: true,
    verification_status: "verified",
    last_verified_at: null,
    rating: null,
    units_sold: null,
    shipping_info: null,
    discount_percent: null,
    brands: { is_verified_seller: true },
    ...overrides,
  };
}

/** Minimal stand-in for the PostgREST chain rankDupes uses: select + ilike +
 * neq + eq + limit, resolving to the full row set (filtering already
 * happens in rankDupes itself against real query params in production; the
 * fake just hands back everything so the test controls exactly what rankDupes
 * sees). */
function fakeSupabase(rows: ProductRow[]): SupabaseClient<Database> {
  const from = () => {
    const chain = {
      select: () => chain,
      ilike: () => chain,
      neq: () => chain,
      eq: () => chain,
      limit: () => chain,
      then: (resolve: (v: { data: ProductRow[]; error: null }) => void) => {
        resolve({ data: rows, error: null });
      },
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

/** Stand-in that behaves like the catalogue query on the one filter this
 * suite cares about: `ilike("category", x)` keeps only rows whose category
 * equals x, case-insensitively. Records every ilike so a test can also assert
 * which category was searched. */
function catalogueSupabase(rows: ProductRow[]) {
  const searches: { column: string; pattern: string }[] = [];
  const from = () => {
    let matching = rows;
    const chain = {
      select: () => chain,
      ilike: (column: string, pattern: string) => {
        searches.push({ column, pattern });
        matching = matching.filter((r) => r.category.toLowerCase() === pattern.toLowerCase());
        return chain;
      },
      neq: () => chain,
      eq: () => chain,
      limit: () => chain,
      then: (resolve: (v: { data: ProductRow[]; error: null }) => void) => {
        resolve({ data: matching, error: null });
      },
    };
    return chain;
  };
  return { supabase: { from } as unknown as SupabaseClient<Database>, searches };
}

describe("extractBudgetTag", () => {
  test("returns the first recognized budget tag", () => {
    expect(extractBudgetTag(["Relaxed Fit", "Mid-Range", "Sneakers Preferred"])).toBe("Mid-Range");
  });

  test("returns null when no budget tag is present", () => {
    expect(extractBudgetTag(["Relaxed Fit", "Sneakers Preferred"])).toBeNull();
  });

  test("returns null for non-array, undefined, or null input", () => {
    expect(extractBudgetTag(undefined)).toBeNull();
    expect(extractBudgetTag(null)).toBeNull();
    expect(extractBudgetTag("Mid-Range")).toBeNull();
  });
});

describe("priceTier", () => {
  const prices = [10, 20, 30, 40, 50, 60, 70, 80, 90];

  test("splits into low/mid/high terciles by sorted position", () => {
    expect(priceTier(prices, 10)).toBe("low");
    expect(priceTier(prices, 30)).toBe("low");
    expect(priceTier(prices, 40)).toBe("mid");
    expect(priceTier(prices, 60)).toBe("mid");
    expect(priceTier(prices, 70)).toBe("high");
    expect(priceTier(prices, 90)).toBe("high");
  });

  test("a single price is always its own low tier", () => {
    expect(priceTier([42], 42)).toBe("low");
  });
});

describe("rankDupes budget alignment", () => {
  test("boosts and tags the reason for a candidate matching the Budget-Conscious tier", async () => {
    const supabase = fakeSupabase([
      product("cheap", { price: 20 }),
      product("mid", { price: 50 }),
      product("pricey", { price: 90 }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, "Budget-Conscious");
    const cheap = results.find((r) => r.id === "cheap");
    expect(cheap?.match_reasons).toContain("Fits your Budget-Conscious budget");
    // The boosted cheap item outranks equally-matched pricier items.
    expect(results[0].id).toBe("cheap");
  });

  test("boosts a candidate matching the Investment Pieces tier", async () => {
    const supabase = fakeSupabase([
      product("cheap", { price: 20 }),
      product("mid", { price: 50 }),
      product("pricey", { price: 90 }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, "Investment Pieces");
    const pricey = results.find((r) => r.id === "pricey");
    expect(pricey?.match_reasons).toContain("Fits your Investment Pieces budget");
    expect(results[0].id).toBe("pricey");
  });

  test("no budget tag leaves ranking and reasons unchanged", async () => {
    const supabase = fakeSupabase([
      product("cheap", { price: 20 }),
      product("pricey", { price: 90 }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null);
    for (const r of results) {
      expect(r.match_reasons.some((reason) => reason.startsWith("Fits your"))).toBe(false);
    }
  });

  test("never surfaces an item that scored 0 on attribute match just because it fits the budget", async () => {
    const supabase = fakeSupabase([
      product("irrelevant", {
        price: 5,
        description: "plain leather sole, no quilting.",
        category: "Shoes",
        title: "Leather Loafers",
      }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, "Budget-Conscious");
    expect(results).toHaveLength(0);
  });
});

describe("rankDupes maxBudget", () => {
  test("drops candidates priced above the user-set ceiling", async () => {
    const supabase = fakeSupabase([
      product("cheap", { price: 20 }),
      product("mid", { price: 50 }),
      product("pricey", { price: 90 }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null, 50);
    expect(results.map((r) => r.id).sort()).toEqual(["cheap", "mid"]);
  });

  test("a candidate priced exactly at the ceiling is kept", async () => {
    const supabase = fakeSupabase([product("edge", { price: 50 })]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null, 50);
    expect(results.map((r) => r.id)).toEqual(["edge"]);
  });

  test("omitted maxBudget applies no ceiling", async () => {
    const supabase = fakeSupabase([product("pricey", { price: 90 })]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null, null);
    expect(results.map((r) => r.id)).toEqual(["pricey"]);
  });

  test("combines with a budget tag: ceiling filters first, tag still re-ranks what's left", async () => {
    const supabase = fakeSupabase([
      product("cheap", { price: 20 }),
      product("mid", { price: 50 }),
      product("pricey", { price: 90 }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, "Investment Pieces", 60);
    expect(results.map((r) => r.id)).not.toContain("pricey");
    expect(results[0].id).toBe("mid");
  });
});

describe("rankDupes category search", () => {
  const BAG: ClothingAttributes = { ...INSPIRATION, category: "Bags" };
  const NECKLACE: ClothingAttributes = {
    ...INSPIRATION,
    name: "Quilted gold pendant necklace",
    category: "Jewelry",
  };

  const CATALOGUE = [
    product("tote", { category: "Bags", title: "Quilted Tote" }),
    product("necklace", { category: "Jewelry", title: "Quilted Pendant Necklace" }),
    product("socks", { category: "Accessories", title: "Quilted Socks" }),
  ];

  test("a bag searches the Bags rows, never the Accessories ones", async () => {
    const { supabase, searches } = catalogueSupabase(CATALOGUE);
    const results = await rankDupes(supabase, BAG, 10);
    expect(searches).toEqual([{ column: "category", pattern: "Bags" }]);
    expect(results.map((r) => r.id)).toEqual(["tote"]);
  });

  test("jewellery searches the Jewelry rows, never the Accessories ones", async () => {
    const { supabase, searches } = catalogueSupabase(CATALOGUE);
    const results = await rankDupes(supabase, NECKLACE, 10);
    expect(searches).toEqual([{ column: "category", pattern: "Jewelry" }]);
    expect(results.map((r) => r.id)).toEqual(["necklace"]);
  });

  test("a belt or hat still searches the Accessories rows", async () => {
    const { supabase, searches } = catalogueSupabase(CATALOGUE);
    // An Accessories piece (2026-10-07: this was the vanity case, which is a
    // top-handle bag; matching it to socks is the unrelated-match bug).
    const SOCKS: ClothingAttributes = { ...INSPIRATION, name: "Quilted cream socks" };
    const results = await rankDupes(supabase, SOCKS, 10);
    expect(searches).toEqual([{ column: "category", pattern: "Accessories" }]);
    expect(results.map((r) => r.id)).toEqual(["socks"]);
  });

  test("a bag misfiled under Accessories returns nothing, never the socks", async () => {
    const { supabase, searches } = catalogueSupabase(CATALOGUE);
    const results = await rankDupes(supabase, INSPIRATION, 10);
    expect(searches).toEqual([{ column: "category", pattern: "Accessories" }]);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Strict matching (owner report 2026-10-07: a formal striped women's coat
// returned sports jackets). Fixture rows are real catalogue rows.
// ---------------------------------------------------------------------------

const STRIPED_FORMAL_WOMENS_COAT: DupeAttributes = {
  name: "Navy pinstripe double-breasted wool coat",
  category: "Outerwear",
  primary_color: "Navy",
  color_undertone: "Cool",
  silhouette_tags: ["double-breasted", "tailored", "longline"],
  garment_type: "coat",
  gender_fit: "womenswear",
  formality: "formal",
  pattern: "striped",
  colors: ["navy", "white"],
  length: "knee",
  fabric: "wool blend",
  key_details: ["notch lapels", "double-breasted", "flap pockets"],
};

const MENS_ATHLETIC_JACKET: DupeAttributes = {
  name: "Black nylon track jacket",
  category: "Outerwear",
  primary_color: "Black",
  color_undertone: "Neutral",
  silhouette_tags: ["zip-front", "stand collar"],
  garment_type: "athletic jacket",
  gender_fit: "menswear",
  formality: "athletic",
  pattern: "solid",
  colors: ["black"],
  length: "hip",
  fabric: "recycled polyester",
  key_details: ["full zip", "stand collar"],
};

const SPORTY_IDS = SPORTY_OUTERWEAR.map((r) => r.id);
const WOMENS_FORMAL_IDS = WOMENS_FORMAL_OUTERWEAR.map((r) => r.id);
const MENS_COAT_IDS = MENS_COATS.map((r) => r.id);

describe("rankDupes strict matching", () => {
  test("a striped formal women's coat never returns sports jackets, fleeces, puffers or vests", async () => {
    const { supabase } = catalogueSupabase([...OUTERWEAR_CATALOGUE, PINSTRIPE_COAT]);
    const results = await rankDupes(supabase, STRIPED_FORMAL_WOMENS_COAT, 20);
    const ids = results.map((r) => r.id);
    for (const sporty of SPORTY_IDS) expect(ids).not.toContain(sporty);
    for (const mens of MENS_COAT_IDS) expect(ids).not.toContain(mens);
    expect(ids[0]).toBe("pinstripe-coat");
  });

  test("every match carries a 0-100 similarity and a one-line reason", async () => {
    const { supabase } = catalogueSupabase([...OUTERWEAR_CATALOGUE, PINSTRIPE_COAT]);
    const [top] = await rankDupes(supabase, STRIPED_FORMAL_WOMENS_COAT, 20);
    expect(top.similarity).toBeGreaterThanOrEqual(90);
    expect(top.similarity).toBeLessThanOrEqual(100);
    expect(typeof top.matchReason).toBe("string");
    expect(top.matchReason?.length).toBeGreaterThan(0);
    // The legacy fields stay on every match.
    expect(typeof top.match_score).toBe("number");
    expect(top.match_reasons.length).toBeGreaterThan(0);
  });

  test("returns nothing rather than unrelated pieces when no coat is close enough", async () => {
    const { supabase } = catalogueSupabase(OUTERWEAR_CATALOGUE);
    const results = await rankDupes(supabase, STRIPED_FORMAL_WOMENS_COAT, 20);
    expect(results).toEqual([]);
  });

  test("a men's athletic jacket never returns women's tailored coats or blazers", async () => {
    const { supabase } = catalogueSupabase([...OUTERWEAR_CATALOGUE, PINSTRIPE_COAT]);
    const results = await rankDupes(supabase, MENS_ATHLETIC_JACKET, 20);
    const ids = results.map((r) => r.id);
    for (const formal of [...WOMENS_FORMAL_IDS, "pinstripe-coat"]) {
      expect(ids).not.toContain(formal);
    }
    for (const mens of MENS_COAT_IDS) expect(ids).not.toContain(mens);
    expect(ids).toContain("nike-windrunner");
  });

  test("the member's profile gender fills in when the photo reads as unisex", async () => {
    const { supabase } = catalogueSupabase([...OUTERWEAR_CATALOGUE, PINSTRIPE_COAT]);
    const unisexTrack: DupeAttributes = { ...MENS_ATHLETIC_JACKET, gender_fit: "unisex" };
    const results = await rankDupes(supabase, unisexTrack, 20, undefined, null, null, {
      gender: "Female",
    });
    const ids = results.map((r) => r.id);
    for (const mensOnly of ["nike-windrunner", "nike-shori-track", "nike-sb-track"]) {
      expect(ids).not.toContain(mensOnly);
    }
  });

  test("a database without the attire column still answers, from the plain columns", async () => {
    const selects: string[] = [];
    const from = () => {
      let columns = "";
      const chain = {
        select: (c: string) => {
          columns = c;
          selects.push(c);
          return chain;
        },
        ilike: () => chain,
        neq: () => chain,
        eq: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => void) => {
          resolve(
            columns.includes("attire")
              ? {
                  data: null,
                  error: { code: "42703", message: "column products.attire does not exist" },
                }
              : { data: [PINSTRIPE_COAT], error: null },
          );
        },
      };
      return chain;
    };
    const supabase = { from } as unknown as SupabaseClient<Database>;

    const results = await rankDupes(supabase, STRIPED_FORMAL_WOMENS_COAT, 5);

    expect(results.map((r) => r.id)).toEqual(["pinstripe-coat"]);
    expect(selects).toHaveLength(2);
    expect(selects[1]).not.toContain("attire");
  });

  test("any other catalogue error still fails loudly", async () => {
    const from = () => {
      const chain = {
        select: () => chain,
        ilike: () => chain,
        neq: () => chain,
        eq: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => void) => {
          resolve({ data: null, error: { code: "57014", message: "statement timeout" } });
        },
      };
      return chain;
    };
    const supabase = { from } as unknown as SupabaseClient<Database>;
    await expect(rankDupes(supabase, STRIPED_FORMAL_WOMENS_COAT, 5)).rejects.toThrow(
      "Couldn't search the dupe catalog.",
    );
  });

  test("a post item's stored attributes (no spec fields) still get the strict filters", async () => {
    const { supabase } = catalogueSupabase([...OUTERWEAR_CATALOGUE, PINSTRIPE_COAT]);
    const legacy: ClothingAttributes = {
      name: "Navy pinstripe tailored coat",
      category: "Outerwear",
      primary_color: "Navy",
      color_undertone: "Cool",
      silhouette_tags: ["double-breasted", "notch lapels"],
    };
    const ids = (await rankDupes(supabase, legacy, 20)).map((r) => r.id);
    for (const sporty of SPORTY_IDS) expect(ids).not.toContain(sporty);
    expect(ids).toContain("pinstripe-coat");
  });
});

// ---------------------------------------------------------------------------
// The owner's Zara case (2026-10-07): a formal women's striped wool coat.
// ---------------------------------------------------------------------------

const ZARA_STRIPED_COAT: DupeAttributes = {
  name: "Navy striped double-breasted wool coat",
  category: "Outerwear",
  primary_color: "Navy",
  color_undertone: "Cool",
  silhouette_tags: ["double-breasted", "tailored", "notch lapels"],
  garment_type: "coat",
  gender_fit: "womenswear",
  formality: "formal",
  closure: "double-breasted",
  pattern: "striped",
  colors: ["navy", "white"],
  length: "knee",
  fabric: "wool",
  key_details: ["notch lapels", "double-breasted"],
};

describe("rankDupes: the Zara case", () => {
  test("the striped wool overcoat ranks first and the sports track jacket never appears", async () => {
    const { supabase } = catalogueSupabase(ZARA_CASE_CATALOGUE);
    const ids = (await rankDupes(supabase, ZARA_STRIPED_COAT, 6)).map((r) => r.id);
    expect(ids[0]).toBe(ZARA_STRIPED_OVERCOAT.id);
    expect(ids).not.toContain(ZARA_TRACK_JACKET.id);
  });

  test("a puffer and a plain coat are not look-alikes for a striped coat", async () => {
    const { supabase } = catalogueSupabase(ZARA_CASE_CATALOGUE);
    const ids = (await rankDupes(supabase, ZARA_STRIPED_COAT, 6)).map((r) => r.id);
    expect(ids).not.toContain(ZARA_PUFFER.id);
    expect(ids).not.toContain(ZARA_PLAIN_COAT.id);
  });

  test("being in the same category is not enough on its own", async () => {
    const { supabase } = catalogueSupabase([ZARA_TRACK_JACKET, ZARA_PUFFER]);
    expect(await rankDupes(supabase, ZARA_STRIPED_COAT, 6)).toEqual([]);
  });

  test("with real seeded rows mixed in (a tailored coat, a trench, a track jacket), only the striped overcoat comes back", async () => {
    const { supabase } = catalogueSupabase([...ZARA_CASE_CATALOGUE, ...ZARA_CASE_REAL_ROWS]);
    const ids = (await rankDupes(supabase, ZARA_STRIPED_COAT, 6)).map((r) => r.id);
    expect(ids).toEqual([ZARA_STRIPED_OVERCOAT.id]);
  });
});

describe("rankDupes recall on real shop copy", () => {
  test("a beige belted trench finds real seeded trenches, and nothing but coats", async () => {
    const beigeTrench: DupeAttributes = {
      name: "Beige belted trench coat",
      category: "Outerwear",
      primary_color: "Beige",
      color_undertone: "Warm",
      silhouette_tags: ["belted", "double-breasted", "storm flap"],
      garment_type: "trench coat",
      gender_fit: "womenswear",
      formality: "smart",
      closure: "belted",
      pattern: "solid",
      colors: ["beige"],
      length: "knee",
      fabric: "cotton twill",
      key_details: ["belted waist", "epaulettes"],
    };
    const { supabase } = catalogueSupabase([...OUTERWEAR_CATALOGUE, ...REAL_TRENCHES]);
    const ids = (await rankDupes(supabase, beigeTrench, 10)).map((r) => r.id);
    const trenches = ["everlane-long-trench", ...REAL_TRENCHES.map((r) => r.id)];
    expect(ids.filter((id) => trenches.includes(id)).length).toBeGreaterThanOrEqual(2);
    for (const id of ids) expect(trenches).toContain(id);
  });
});

// ---------------------------------------------------------------------------
// findDupesForUser: one vision call identifies the piece -> our catalogue ->
// strict scoring -> threshold. The AI is faked; no keys needed.
// ---------------------------------------------------------------------------

const TRUSTED_IMAGE = "https://project.supabase.test/storage/v1/object/public/outfits/u/a.jpg";

/** Table-aware stand-in: `profiles` answers maybeSingle with `profile`,
 * `products` behaves like catalogueSupabase. */
function huntSupabase(rows: FixtureProductRow[], profile: Record<string, unknown>) {
  const from = (table: string) => {
    let matching = rows;
    const chain = {
      select: () => chain,
      ilike: (_column: string, pattern: string) => {
        matching = matching.filter((r) => r.category.toLowerCase() === pattern.toLowerCase());
        return chain;
      },
      neq: () => chain,
      eq: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: profile, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        resolve({ data: table === "products" ? matching : [], error: null });
      },
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

/** The extraction answers with `read` (or fails); withAiCredit records what
 * its refundIf said about the result. */
function huntDeps(
  read: Record<string, unknown> | "fail",
  options: { refundStoreDown?: boolean } = {},
) {
  const toolCalls: string[] = [];
  const refundChecks: boolean[] = [];
  /** Every rate-limit key consumed, with its policy; behaves like the real
   * store: past `policy.limit` uses of one key it throws. */
  const limits: Array<{ key: string; policy: RateLimitPolicy }> = [];
  const deps: FindDupesDeps = {
    consumeRateLimit: (async (key: string, policy: RateLimitPolicy) => {
      if (options.refundStoreDown && key.includes(":refund:")) {
        throw new Error("Request protection is temporarily unavailable.");
      }
      limits.push({ key, policy });
      const used = limits.filter((l) => l.key === key).length;
      if (used > policy.limit) throw new RateLimitExceededError(60);
      return undefined;
    }) as unknown as FindDupesDeps["consumeRateLimit"],
    withAiCredit: (async (
      _supabase: unknown,
      _userId: string,
      produce: () => Promise<unknown>,
      opts?: { refundIf?: (r: unknown) => boolean },
    ) => {
      const result = await produce();
      refundChecks.push(opts?.refundIf?.(result) ?? false);
      return result;
    }) as unknown as FindDupesDeps["withAiCredit"],
    aiChatCompletion: (async (_messages: unknown, tool: AiTool) => {
      toolCalls.push(tool.function.name);
      return read === "fail" ? { ok: false, status: 504 } : { ok: true, args: read };
    }) as unknown as FindDupesDeps["aiChatCompletion"],
  };
  return { deps, toolCalls, refundChecks, limits };
}

describe("findDupesForUser", () => {
  // The SSRF guard reads SUPABASE_URL; set it for this suite only and put the
  // previous value back so no later test file sees it.
  let previousSupabaseUrl: string | undefined;
  beforeAll(() => {
    previousSupabaseUrl = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = "https://project.supabase.test";
  });
  afterAll(() => {
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
  });
  const INPUT = { imageUrl: TRUSTED_IMAGE, maxResults: 6 };
  const REFUND_KEY = "ai:findDupes:refund:user-1";

  test("one AI call identifies the piece; the striped overcoat comes back first, never the track jacket", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, {
      shopping_preferences: [],
      gender: "Female",
    });
    const { deps, toolCalls, refundChecks } = huntDeps(ZARA_STRIPED_COAT);

    const result = await findDupesForUser(supabase, "user-1", INPUT, deps);

    expect(toolCalls).toEqual(["report_clothing_attributes"]);
    expect(result.dupes[0].id).toBe(ZARA_STRIPED_OVERCOAT.id);
    expect(result.dupes.map((d) => d.id)).not.toContain(ZARA_TRACK_JACKET.id);
    expect(result.dupes[0].similarity).toBeGreaterThanOrEqual(90);
    expect(result.dupes[0].matchReason).toBeTruthy();
    expect(result.matchQuality).toBe("identical");
    expect(result.message).toBeUndefined();
    expect(refundChecks).toEqual([false]);
  });

  test("the identified attributes round-trip to the response, with a one-line summary", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, { shopping_preferences: [], gender: null });
    const { deps } = huntDeps(ZARA_STRIPED_COAT);

    const result = await findDupesForUser(supabase, "user-1", INPUT, deps);

    expect(result.inspiration).toEqual(ZARA_STRIPED_COAT);
    expect(result.identifiedAs).toBe(
      "A women's navy and white striped double-breasted wool coat, knee length, formal",
    );
  });

  test("every existing response field is still there", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, { shopping_preferences: [], gender: null });
    const { deps } = huntDeps(ZARA_STRIPED_COAT);

    const [top] = (await findDupesForUser(supabase, "user-1", INPUT, deps)).dupes;

    for (const field of [
      "id",
      "title",
      "brand_id",
      "category",
      "price",
      "currency",
      "image_url",
      "affiliate_link",
      "description",
      "match_score",
      "match_reasons",
      "verification_status",
      "last_verified_at",
      "rating",
      "units_sold",
      "shipping_info",
      "discount_percent",
      "is_verified_seller",
    ]) {
      expect(top).toHaveProperty(field);
    }
    expect(top.match_reasons[0]).toBe(top.matchReason);
  });

  test("nothing close enough: empty list, 'none', a calm message, and the credit is refunded", async () => {
    const supabase = huntSupabase([ZARA_TRACK_JACKET, ZARA_PUFFER, ZARA_PLAIN_COAT], {
      shopping_preferences: [],
      gender: "Female",
    });
    const { deps, refundChecks } = huntDeps(ZARA_STRIPED_COAT);

    const result = await findDupesForUser(supabase, "user-1", INPUT, deps);

    expect(result.dupes).toEqual([]);
    expect(result.matchQuality).toBe("none");
    expect(result.message).toBe("Nothing in our catalogue is close enough to this coat yet.");
    expect(result.identifiedAs).toContain("striped");
    expect(refundChecks).toEqual([true]);
  });

  // Refund rule (security review 2026-10-07): her own filters never decide
  // whether a hunt is refunded. The refund depends on the CATALOGUE having
  // nothing close.

  test("close matches above her budget: no refund, and the message says why", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, {
      shopping_preferences: [],
      gender: "Female",
    });
    const { deps, refundChecks, limits } = huntDeps(ZARA_STRIPED_COAT);

    const result = await findDupesForUser(supabase, "user-1", { ...INPUT, maxBudget: 1 }, deps);

    expect(result.dupes).toEqual([]);
    expect(result.matchQuality).toBe("none");
    expect(result.message).toBe("Close matches exist above your budget.");
    expect(refundChecks).toEqual([false]);
    // No refund slot is spent on a hunt that is charged.
    expect(limits.map((l) => l.key)).not.toContain(REFUND_KEY);
  });

  test("close matches outside her region: no refund, and the message says why", async () => {
    const usOnly = { ...ZARA_STRIPED_OVERCOAT, available_regions: ["US"] };
    const supabase = huntSupabase([ZARA_TRACK_JACKET, ZARA_PUFFER, usOnly], {
      shopping_preferences: [],
      gender: "Female",
    });
    const { deps, refundChecks, limits } = huntDeps(ZARA_STRIPED_COAT);

    const result = await findDupesForUser(supabase, "user-1", { ...INPUT, region: "PH" }, deps);

    expect(result.dupes).toEqual([]);
    expect(result.message).toBe("Close matches exist outside your region.");
    expect(refundChecks).toEqual([false]);
    expect(limits.map((l) => l.key)).not.toContain(REFUND_KEY);
  });

  test("when the refund cap cannot be checked, the hunt is charged (fail closed) without an error", async () => {
    const supabase = huntSupabase([ZARA_TRACK_JACKET, ZARA_PUFFER], {
      shopping_preferences: [],
      gender: "Female",
    });
    const { deps, refundChecks } = huntDeps(ZARA_STRIPED_COAT, { refundStoreDown: true });

    const result = await findDupesForUser(supabase, "user-1", INPUT, deps);

    expect(result.matchQuality).toBe("none");
    expect(refundChecks).toEqual([false]);
  });

  test("refunds are capped at 3 per member per 24 hours; the 4th empty hunt is charged, without an error", async () => {
    const supabase = huntSupabase([ZARA_TRACK_JACKET, ZARA_PUFFER], {
      shopping_preferences: [],
      gender: "Female",
    });
    const { deps, refundChecks, limits } = huntDeps(ZARA_STRIPED_COAT);

    for (let hunt = 0; hunt < 4; hunt += 1) {
      const result = await findDupesForUser(supabase, "user-1", INPUT, deps);
      expect(result.matchQuality).toBe("none");
    }

    expect(refundChecks).toEqual([true, true, true, false]);
    const refundCap = limits.find((l) => l.key !== "ai:findDupes:user-1");
    expect(refundCap?.policy).toEqual({ limit: 3, windowSeconds: 86_400 });
  });

  test("a failed identification still throws, so the credit wrapper refunds it as before", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, { shopping_preferences: [], gender: null });
    const { deps } = huntDeps("fail");
    await expect(findDupesForUser(supabase, "user-1", INPUT, deps)).rejects.toThrow();
  });

  test("a long AI name is trimmed instead of failing the hunt", async () => {
    const supabase = huntSupabase([ZARA_STRIPED_OVERCOAT], {
      shopping_preferences: [],
      gender: null,
    });
    const { deps } = huntDeps({ ...ZARA_STRIPED_COAT, name: "x".repeat(140) });

    const result = await findDupesForUser(supabase, "user-1", INPUT, deps);
    expect(result.inspiration.name.length).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// P2B-S2: the hunt runs as a generation job. The matching method above is
// unchanged; the job only charges once per request, keeps what she was shown,
// and refunds a hunt with nothing close exactly once, within the daily cap.
// ---------------------------------------------------------------------------

const JOB_USER = "user-1";
const JOB_INPUT = { imageUrl: TRUSTED_IMAGE, maxResults: 6 };
const REFUND_SLOT_KEY = "ai:findDupes:refund:user-1";
/** Nothing in this catalogue is close to the striped coat. */
const NOTHING_CLOSE = [ZARA_TRACK_JACKET, ZARA_PUFFER, ZARA_PLAIN_COAT];
/** A UTF-16 surrogate with no partner: jsonb refuses a row that holds one. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const FEMALE_PROFILE = { shopping_preferences: [], gender: "Female" };

function requestId(n: number): string {
  return `4c1f6a2e-8b3d-4e7a-9c2f-${String(n).padStart(12, "0")}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** huntDeps plus the job seams: an in-memory generation_jobs store holding 5
 * credits, or (legacy) a generation_jobs migration that is not applied. Counts
 * every call into the legacy credit wrapper. With a deadline, the persist
 * reserve is 0 (no write grace) unless `persistReserveMs` says otherwise;
 * `claimDelayMs` makes the refund-slot claim take that long. */
function jobHuntDeps(
  read: Record<string, unknown> | "fail",
  options: {
    legacy?: boolean;
    deadlineSeconds?: number;
    persistReserveMs?: number;
    claimDelayMs?: number;
  } = {},
) {
  const store = new MemoryGenerationJobStore();
  store.seed(JOB_USER, 5);
  const hunt = huntDeps(read);
  const counts = { legacyCharges: 0 };
  const legacyWithAiCredit = hunt.deps.withAiCredit as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const rateLimit = hunt.deps.consumeRateLimit as unknown as (
    key: string,
    policy: RateLimitPolicy,
  ) => Promise<unknown>;
  const jobs: GenerationJobDeps = options.legacy
    ? { availability: { isMissing: () => true, markMissing: () => {} } }
    : {
        store,
        availability: createAvailabilityCache(60_000),
        ...(options.deadlineSeconds === undefined
          ? {}
          : { persistReserveMs: options.persistReserveMs ?? 0 }),
      };
  const deps: FindDupesDeps = {
    ...hunt.deps,
    consumeRateLimit: (async (key: string, policy: RateLimitPolicy) => {
      if (options.claimDelayMs && key === REFUND_SLOT_KEY) await sleep(options.claimDelayMs);
      return rateLimit(key, policy);
    }) as unknown as FindDupesDeps["consumeRateLimit"],
    withAiCredit: (async (...args: unknown[]) => {
      counts.legacyCharges += 1;
      return legacyWithAiCredit(...args);
    }) as unknown as FindDupesDeps["withAiCredit"],
    jobs,
    dailyAllowance: async () => 5,
    deadlineSeconds: options.deadlineSeconds,
  };
  const refundSlots = () => hunt.limits.filter((l) => l.key === REFUND_SLOT_KEY).length;
  return { ...hunt, deps, store, counts, refundSlots };
}

function storedHunt(row: { result: unknown }): DupeHuntResult {
  return row.result as DupeHuntResult;
}

describe("findDupesForUser as a generation job", () => {
  let previousSupabaseUrl: string | undefined;
  beforeAll(() => {
    previousSupabaseUrl = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = "https://project.supabase.test";
  });
  afterAll(() => {
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
  });

  test("refundable zero: job failed with the stored hunt, refunded once, refund slot claimed once", async () => {
    const supabase = huntSupabase(NOTHING_CLOSE, FEMALE_PROFILE);
    const { deps, store, counts, refundSlots } = jobHuntDeps(ZARA_STRIPED_COAT);

    const hunt = await findDupesForUser(
      supabase,
      JOB_USER,
      { ...JOB_INPUT, clientRequestId: requestId(1) },
      deps,
    );

    expect(hunt.dupes).toEqual([]);
    expect(hunt.matchQuality).toBe("none");
    expect(hunt.message).toBe("Nothing in our catalogue is close enough to this coat yet.");
    expect(hunt.creditRefunded).toBe(true);
    expect(store.rows).toHaveLength(1);
    const [row] = store.rows;
    expect(hunt.jobId).toBe(row.id);
    expect(row).toMatchObject({
      kind: "dupe_search",
      status: "failed",
      error_code: "no_close_match",
      credit_state: "refunded",
    });
    expect(storedHunt(row)).toEqual({
      inspiration: hunt.inspiration,
      dupes: [],
      identifiedAs: hunt.identifiedAs,
      matchQuality: "none",
      message: hunt.message,
      creditRefunded: true,
    });
    // The request id is the job's key, never part of its input.
    expect(row.input).toEqual({ imageUrl: TRUSTED_IMAGE, maxResults: 6 });
    expect(JSON.stringify(row.input)).not.toContain(requestId(1));
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(JOB_USER)).toEqual({ daily: 5, purchased: 0 });
    expect(refundSlots()).toBe(1);
    // The job charged and refunded; the legacy credit wrapper never ran.
    expect(counts.legacyCharges).toBe(0);
  });

  test("replay of a refunded hunt answers the stored hunt (identifiedAs, message, creditRefunded) with no new claim, charge or AI call", async () => {
    const supabase = huntSupabase(NOTHING_CLOSE, FEMALE_PROFILE);
    const { deps, store, toolCalls, refundSlots } = jobHuntDeps(ZARA_STRIPED_COAT);
    const input = { ...JOB_INPUT, clientRequestId: requestId(1) };

    const first = await findDupesForUser(supabase, JOB_USER, input, deps);
    const replay = await findDupesForUser(supabase, JOB_USER, input, deps);

    expect(replay).toEqual(first);
    expect(replay.identifiedAs).toBe(first.identifiedAs);
    expect(replay.message).toBe("Nothing in our catalogue is close enough to this coat yet.");
    expect(replay.creditRefunded).toBe(true);
    expect(replay.jobId).toBe(store.rows[0].id);
    expect(toolCalls).toEqual(["report_clothing_attributes"]);
    expect(refundSlots()).toBe(1);
    expect(store.rows).toHaveLength(1);
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(JOB_USER)).toEqual({ daily: 5, purchased: 0 });
  });

  test("filters hid close matches: charged, stored as success, no slot used", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, FEMALE_PROFILE);
    const { deps, store, refundSlots } = jobHuntDeps(ZARA_STRIPED_COAT);

    const hunt = await findDupesForUser(
      supabase,
      JOB_USER,
      { ...JOB_INPUT, maxBudget: 1, clientRequestId: requestId(1) },
      deps,
    );

    expect(hunt.dupes).toEqual([]);
    expect(hunt.message).toBe("Close matches exist above your budget.");
    expect(hunt.creditRefunded).toBeUndefined();
    const [row] = store.rows;
    expect(row).toMatchObject({ status: "succeeded", credit_state: "charged", error_code: null });
    expect(storedHunt(row)).toMatchObject({
      matchQuality: "none",
      message: "Close matches exist above your budget.",
      hiddenByFilters: { aboveBudget: true, outsideRegion: false },
    });
    expect(Object.keys(storedHunt(row))).not.toContain("creditRefunded");
    expect(store.calls.refunds).toBe(0);
    expect(store.balance(JOB_USER)).toEqual({ daily: 4, purchased: 0 });
    expect(refundSlots()).toBe(0);

    // Coming back to it answers the same hunt, why-nothing-shows included.
    const replay = await findDupesForUser(
      supabase,
      JOB_USER,
      { ...JOB_INPUT, maxBudget: 1, clientRequestId: requestId(1) },
      deps,
    );
    expect(replay).toEqual(hunt);
    expect(replay.hiddenByFilters).toEqual({ aboveBudget: true, outsideRegion: false });
    expect(store.balance(JOB_USER)).toEqual({ daily: 4, purchased: 0 });
  });

  test("cap used up: charged and stored as success with creditRefunded absent", async () => {
    const supabase = huntSupabase([ZARA_TRACK_JACKET, ZARA_PUFFER], FEMALE_PROFILE);
    const { deps, store } = jobHuntDeps(ZARA_STRIPED_COAT);

    for (let hunt = 1; hunt <= 3; hunt += 1) {
      const refunded = await findDupesForUser(
        supabase,
        JOB_USER,
        { ...JOB_INPUT, clientRequestId: requestId(hunt) },
        deps,
      );
      expect(refunded.creditRefunded).toBe(true);
    }
    const fourth = await findDupesForUser(
      supabase,
      JOB_USER,
      { ...JOB_INPUT, clientRequestId: requestId(4) },
      deps,
    );

    expect(fourth.matchQuality).toBe("none");
    expect(fourth.message).toBe("Nothing in our catalogue is close enough to this coat yet.");
    expect(fourth.creditRefunded).toBeUndefined();
    expect(Object.keys(fourth)).not.toContain("creditRefunded");
    const row = store.rows[3];
    expect(row).toMatchObject({ status: "succeeded", credit_state: "charged" });
    expect(Object.keys(storedHunt(row))).not.toContain("creditRefunded");
    expect(store.rows.slice(0, 3).map((r) => r.error_code)).toEqual([
      "no_close_match",
      "no_close_match",
      "no_close_match",
    ]);
    expect(store.calls.refunds).toBe(3);
    expect(store.balance(JOB_USER)).toEqual({ daily: 4, purchased: 0 });
  });

  test("stored descriptions are capped at 500 characters; the live answer is not", async () => {
    // An emoji straddles the cut, so a plain UTF-16 slice would split it.
    const head = `${ZARA_STRIPED_OVERCOAT.description} `;
    const longCopy = `${head}${".".repeat(498 - head.length)}${"😀".repeat(20)} ${"x".repeat(1500)}`;
    const longOvercoat = { ...ZARA_STRIPED_OVERCOAT, description: longCopy };
    const supabase = huntSupabase([...NOTHING_CLOSE, longOvercoat], FEMALE_PROFILE);
    const { deps, store } = jobHuntDeps(ZARA_STRIPED_COAT);

    const hunt = await findDupesForUser(
      supabase,
      JOB_USER,
      { ...JOB_INPUT, clientRequestId: requestId(1) },
      deps,
    );

    expect(hunt.dupes[0].id).toBe(ZARA_STRIPED_OVERCOAT.id);
    expect(hunt.dupes[0].description).toBe(longCopy);
    const [row] = store.rows;
    expect(row.status).toBe("succeeded");
    const stored = storedHunt(row).dupes[0].description ?? "";
    expect(stored.length).toBeLessThanOrEqual(500);
    expect(stored.endsWith("…")).toBe(true);
    expect(stored.startsWith(head)).toBe(true);
    expect(LONE_SURROGATE.test(stored)).toBe(false);
    for (const dupe of storedHunt(row).dupes) {
      expect((dupe.description ?? "").length).toBeLessThanOrEqual(500);
    }
    // Everything else about the match is kept exactly as shown.
    expect({ ...storedHunt(row).dupes[0], description: longCopy }).toEqual(hunt.dupes[0]);
  });

  test("an attribute parse failure answers calm copy, never zod text, and refunds", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, FEMALE_PROFILE);
    const { deps, store, toolCalls } = jobHuntDeps({
      ...ZARA_STRIPED_COAT,
      category: "Spaceships",
    });
    const input = { ...JOB_INPUT, clientRequestId: requestId(1) };

    const err = await findDupesForUser(supabase, JOB_USER, input, deps).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as Error).message).toBe(
      "Mila couldn't read that piece. Please try a clearer photo.",
    );
    expect(store.rows[0]).toMatchObject({ status: "failed", credit_state: "refunded" });
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(JOB_USER)).toEqual({ daily: 5, purchased: 0 });

    // A replay answers what she saw, with no second AI call.
    const again = await findDupesForUser(supabase, JOB_USER, input, deps).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(AiUnavailableError);
    expect((again as Error).message).toBe(
      "Mila couldn't read that piece. Please try a clearer photo.",
    );
    expect(toolCalls).toHaveLength(1);
    expect(store.calls.refunds).toBe(1);
  });

  test("with the migration missing, an attribute parse failure is the same calm copy", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, FEMALE_PROFILE);
    const { deps, counts } = jobHuntDeps(
      { ...ZARA_STRIPED_COAT, category: "Spaceships" },
      { legacy: true },
    );

    const err = await findDupesForUser(supabase, JOB_USER, JOB_INPUT, deps).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as Error).message).toBe(
      "Mila couldn't read that piece. Please try a clearer photo.",
    );
    expect(counts.legacyCharges).toBe(1);
  });

  test("an untrusted image is refused before any charge", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, FEMALE_PROFILE);
    for (const legacy of [false, true]) {
      const { deps, store, counts, toolCalls } = jobHuntDeps(ZARA_STRIPED_COAT, { legacy });

      const err = await findDupesForUser(
        supabase,
        JOB_USER,
        { ...JOB_INPUT, imageUrl: "https://evil.test/a.jpg", clientRequestId: requestId(1) },
        deps,
      ).catch((e: unknown) => e);

      expect((err as Error).message).toBe(
        "Image must be uploaded to Mila's storage before analysis.",
      );
      expect(counts.legacyCharges).toBe(0);
      expect(store.calls.start).toBe(0);
      expect(store.rows).toHaveLength(0);
      expect(toolCalls).toEqual([]);
      expect(store.balance(JOB_USER)).toEqual({ daily: 5, purchased: 0 });
    }
  });

  test("migration missing: today's path, the refunded hunt says so, and nothing else changes", async () => {
    const { deps, store, counts, refundChecks } = jobHuntDeps(ZARA_STRIPED_COAT, {
      legacy: true,
    });

    const refunded = await findDupesForUser(
      huntSupabase(NOTHING_CLOSE, FEMALE_PROFILE),
      JOB_USER,
      { ...JOB_INPUT, clientRequestId: requestId(1) },
      deps,
    );
    const charged = await findDupesForUser(
      huntSupabase(ZARA_CASE_CATALOGUE, FEMALE_PROFILE),
      JOB_USER,
      { ...JOB_INPUT, clientRequestId: requestId(2) },
      deps,
    );

    expect(counts.legacyCharges).toBe(2);
    expect(refundChecks).toEqual([true, false]);
    expect(refunded.creditRefunded).toBe(true);
    expect(refunded.message).toBe("Nothing in our catalogue is close enough to this coat yet.");
    expect(Object.keys(refunded)).not.toContain("jobId");
    // A charged hunt answers exactly today's shape.
    expect(charged.dupes[0].id).toBe(ZARA_STRIPED_OVERCOAT.id);
    expect(Object.keys(charged)).not.toContain("creditRefunded");
    expect(Object.keys(charged)).not.toContain("jobId");
    expect(store.calls.start).toBe(0);
    expect(store.calls.reap).toBe(0);
  });

  test("a hunt replays from its row: one AI call, one charge, the same matches", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, FEMALE_PROFILE);
    const { deps, store, toolCalls, refundSlots } = jobHuntDeps(ZARA_STRIPED_COAT);
    const input = { ...JOB_INPUT, clientRequestId: requestId(1) };

    const first = await findDupesForUser(supabase, JOB_USER, input, deps);
    const replay = await findDupesForUser(supabase, JOB_USER, input, deps);

    expect(first.dupes[0].id).toBe(ZARA_STRIPED_OVERCOAT.id);
    expect(first.jobId).toBe(store.rows[0].id);
    expect(replay).toEqual(first);
    expect(toolCalls).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: "succeeded", credit_state: "charged" });
    expect(store.balance(JOB_USER)).toEqual({ daily: 4, purchased: 0 });
    expect(refundSlots()).toBe(0);
  });

  test("without fail_generation_job_with_result the refund still lands once, and a replay is told calmly", async () => {
    const supabase = huntSupabase(NOTHING_CLOSE, FEMALE_PROFILE);
    const { deps, store, toolCalls, refundSlots } = jobHuntDeps(ZARA_STRIPED_COAT);
    store.missingFailWithResult = true;
    const input = { ...JOB_INPUT, clientRequestId: requestId(1) };

    const first = await findDupesForUser(supabase, JOB_USER, input, deps);
    expect(first.creditRefunded).toBe(true);
    expect(first.identifiedAs).toContain("striped");
    expect(store.rows[0]).toMatchObject({
      status: "failed",
      error_code: "no_close_match",
      credit_state: "refunded",
      result: null,
    });

    const replay = await findDupesForUser(supabase, JOB_USER, input, deps).catch((e: unknown) => e);
    expect(replay).toBeInstanceOf(DomainValidationError);
    expect((replay as Error).message).toBe(
      "Nothing in our catalogue was close enough to your piece. Your credit is back.",
    );
    expect(toolCalls).toHaveLength(1);
    expect(refundSlots()).toBe(1);
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(JOB_USER)).toEqual({ daily: 5, purchased: 0 });
  });

  test("a hunt that outlives its deadline is refunded once and spends none of her daily refunds", async () => {
    const supabase = huntSupabase(NOTHING_CLOSE, FEMALE_PROFILE);
    const { deps, store, refundSlots } = jobHuntDeps(ZARA_STRIPED_COAT, {
      deadlineSeconds: 0.03,
    });
    const slowAi = (async () => {
      await sleep(80);
      return { ok: true, args: ZARA_STRIPED_COAT };
    }) as unknown as FindDupesDeps["aiChatCompletion"];

    const out = await findDupesForUser(
      supabase,
      JOB_USER,
      { ...JOB_INPUT, clientRequestId: requestId(1) },
      { ...deps, aiChatCompletion: slowAi },
    ).catch((e: unknown) => e);
    // Let the abandoned hunt finish in the background.
    await sleep(150);

    expect(out).toBeInstanceOf(Error);
    expect((out as Error).message).toBe("Dupe extraction failed.");
    expect(store.rows[0]).toMatchObject({
      status: "failed",
      error_code: "deadline_exceeded",
      credit_state: "refunded",
    });
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(JOB_USER)).toEqual({ daily: 5, purchased: 0 });
    expect(refundSlots()).toBe(0);
  });

  // Review probe P3: a refund claim still in flight when the deadline fires.
  // The claim is confirmed by stillRunning() first, so the wrapper's write
  // grace waits for it and the slot settles together with its refund.
  test("a refund claim under way at the deadline settles with its refund: one slot, no_close_match, the hunt kept", async () => {
    const supabase = huntSupabase(NOTHING_CLOSE, FEMALE_PROFILE);
    const { deps, store, refundSlots } = jobHuntDeps(ZARA_STRIPED_COAT, {
      deadlineSeconds: 1,
      // Produce deadline 60 ms, write grace up to 940 ms.
      persistReserveMs: 940,
      claimDelayMs: 80,
    });
    const slowAi = (async () => {
      await sleep(20);
      return { ok: true, args: ZARA_STRIPED_COAT };
    }) as unknown as FindDupesDeps["aiChatCompletion"];

    const out = await findDupesForUser(
      supabase,
      JOB_USER,
      { ...JOB_INPUT, clientRequestId: requestId(1) },
      { ...deps, aiChatCompletion: slowAi },
    ).catch((e: unknown) => e);
    await sleep(150);

    expect(out).not.toBeInstanceOf(Error);
    expect((out as DupeHuntResult).creditRefunded).toBe(true);
    const [row] = store.rows;
    expect(row).toMatchObject({
      status: "failed",
      error_code: "no_close_match",
      credit_state: "refunded",
    });
    expect(storedHunt(row).identifiedAs).toBe((out as DupeHuntResult).identifiedAs);
    expect(refundSlots()).toBe(1);
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(JOB_USER)).toEqual({ daily: 5, purchased: 0 });
  });

  test("when her job cannot be re-read, no refund slot is claimed and the hunt is charged", async () => {
    const supabase = huntSupabase(NOTHING_CLOSE, FEMALE_PROFILE);
    const { deps, store, refundSlots } = jobHuntDeps(ZARA_STRIPED_COAT);
    const unreadable = new Proxy(store, {
      get(target, prop) {
        if (prop === "get") {
          return async () => {
            throw new Error("read failed");
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const hunt = await findDupesForUser(
      supabase,
      JOB_USER,
      { ...JOB_INPUT, clientRequestId: requestId(1) },
      { ...deps, jobs: { ...deps.jobs, store: unreadable } },
    );

    expect(hunt.matchQuality).toBe("none");
    expect(hunt.creditRefunded).toBeUndefined();
    expect(store.rows[0]).toMatchObject({ status: "succeeded", credit_state: "charged" });
    expect(refundSlots()).toBe(0);
    expect(store.calls.refunds).toBe(0);
    expect(store.balance(JOB_USER)).toEqual({ daily: 4, purchased: 0 });
  });

  test("a long AI read never shows half an emoji, and its replay is the same hunt", async () => {
    const supabase = huntSupabase(NOTHING_CLOSE, FEMALE_PROFILE);
    const { deps } = jobHuntDeps({
      ...ZARA_STRIPED_COAT,
      name: `${"a".repeat(99)}😀 trailing`,
      colors: [`${"b".repeat(39)}😀`, "white"],
      key_details: [`${"c".repeat(59)}😀`],
      fabric: `${"d".repeat(59)}😀`,
    });
    const input = { ...JOB_INPUT, clientRequestId: requestId(1) };

    const live = await findDupesForUser(supabase, JOB_USER, input, deps);
    const replay = await findDupesForUser(supabase, JOB_USER, input, deps);

    // A character that does not fit is left out whole; nothing is added.
    expect(live.inspiration.name).toBe("a".repeat(99));
    expect(live.inspiration.colors).toEqual(["b".repeat(39), "white"]);
    expect(live.inspiration.key_details).toEqual(["c".repeat(59)]);
    expect(live.inspiration.fabric).toBe("d".repeat(59));
    const { name, colors = [], key_details = [], fabric = "" } = live.inspiration;
    for (const text of [name, ...colors, ...key_details, fabric]) {
      expect(LONE_SURROGATE.test(text)).toBe(false);
    }
    expect(replay).toEqual(live);
  });

  test("report mode answers running while another hunt is in flight", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, FEMALE_PROFILE);
    const { deps, store } = jobHuntDeps(ZARA_STRIPED_COAT);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedAi = (async () => {
      await gate;
      return { ok: true, args: ZARA_STRIPED_COAT };
    }) as unknown as FindDupesDeps["aiChatCompletion"];

    const first = findDupesForUser(
      supabase,
      JOB_USER,
      { ...JOB_INPUT, clientRequestId: requestId(1) },
      { ...deps, aiChatCompletion: gatedAi },
    );
    await sleep(20);
    const second = await findDupesForUser(
      supabase,
      JOB_USER,
      { ...JOB_INPUT, clientRequestId: requestId(2) },
      deps,
      { inFlight: "report" },
    );

    expect(second).toEqual({ status: "running", jobId: store.rows[0].id });
    release();
    await first;
    expect(store.rows).toHaveLength(1);
  });

  test("a failed identification refunds once on the job path, and its replay fails the same way", async () => {
    const supabase = huntSupabase(ZARA_CASE_CATALOGUE, FEMALE_PROFILE);
    const { deps, store, toolCalls, counts } = jobHuntDeps("fail");
    const input = { ...JOB_INPUT, clientRequestId: requestId(1) };

    const err = await findDupesForUser(supabase, JOB_USER, input, deps).catch((e: unknown) => e);
    const again = await findDupesForUser(supabase, JOB_USER, input, deps).catch((e: unknown) => e);

    expect((err as Error).message).toBe("Dupe extraction failed.");
    expect((again as Error).message).toBe("Dupe extraction failed.");
    expect(store.rows[0]).toMatchObject({ status: "failed", credit_state: "refunded" });
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(JOB_USER)).toEqual({ daily: 5, purchased: 0 });
    expect(toolCalls).toHaveLength(1);
    expect(counts.legacyCharges).toBe(0);
  });
});

describe("rankDupes gender direction", () => {
  // The catalog carries Male / Female / Unisex rows; a hunt must only ever
  // draw from ONE direction plus Unisex. This is the guarantee QA asked for:
  // a woman is never recommended a men's piece (and vice versa).
  const CATALOGUE = [
    product("w-top", { gender: "Female", title: "Quilted Vanity Case" }),
    product("m-shirt", { gender: "Male", title: "Quilted Top-Handle Case" }),
    product("u-scarf", { gender: "Unisex", title: "Quilted Cream Case" }),
  ];

  test("a woman's hunt never surfaces a men's item", async () => {
    const supabase = fakeSupabase([...CATALOGUE]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null, null, {
      genderDirection: "Female",
    });
    expect(results.map((r) => r.id).sort()).toEqual(["u-scarf", "w-top"]);
  });

  test("a man's hunt never surfaces a women's item", async () => {
    const supabase = fakeSupabase([...CATALOGUE]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null, null, {
      genderDirection: "Male",
    });
    expect(results.map((r) => r.id).sort()).toEqual(["m-shirt", "u-scarf"]);
  });

  test("Unisex pieces stay eligible in every direction", async () => {
    for (const direction of ["Male", "Female"] as const) {
      const supabase = fakeSupabase([...CATALOGUE]);
      const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null, null, {
        genderDirection: direction,
      });
      expect(results.map((r) => r.id)).toContain("u-scarf");
    }
  });

  test("no direction applies no gender filter (ad-hoc callers keep legacy behavior)", async () => {
    const supabase = fakeSupabase([...CATALOGUE]);
    const results = await rankDupes(supabase, INSPIRATION, 10);
    expect(results.map((r) => r.id).sort()).toEqual(["m-shirt", "u-scarf", "w-top"]);
  });
});

describe("resolveGenderDirection", () => {
  test("a stated gender resolves to exactly that direction", () => {
    expect(resolveGenderDirection("Female")).toBe("Female");
    expect(resolveGenderDirection("Male")).toBe("Male");
  });

  test("with no stated gender, the photographed piece decides the direction", () => {
    for (let i = 0; i < 30; i += 1) {
      expect(resolveGenderDirection(null, "womenswear")).toBe("Female");
      expect(resolveGenderDirection("Non-binary", "menswear")).toBe("Male");
    }
  });

  test("a stated gender wins over the piece's department", () => {
    expect(resolveGenderDirection("Female", "menswear")).toBe("Female");
    expect(resolveGenderDirection("Male", "womenswear")).toBe("Male");
  });

  test("ambiguous profiles still resolve to ONE valid direction, never a mix", () => {
    for (const ambiguous of ["Non-binary", "Prefer not to say", null, undefined]) {
      const seen = new Set<string>();
      for (let i = 0; i < 60; i += 1) seen.add(resolveGenderDirection(ambiguous));
      // Both directions can occur across calls (it's a coin toss per hunt),
      // but every single resolution is one of the two — nothing else.
      expect([...seen].sort()).toEqual(["Female", "Male"]);
    }
  });
});

/** Profile-aware stand-in: routes `from("profiles")` to the member's row and
 * `from("products")` to the catalogue, and records every profile SELECT so a
 * test can assert the gender column was actually requested. */
function serviceSupabase(
  profile: { shopping_preferences: unknown; gender: string | null },
  rows: ProductRow[],
) {
  const selects: string[] = [];
  const from = (table: string) => {
    if (table === "profiles") {
      const chain = {
        select: (columns: string) => {
          selects.push(columns);
          return chain;
        },
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: profile, error: null }),
      };
      return chain;
    }
    const chain = {
      select: () => chain,
      ilike: () => chain,
      neq: () => chain,
      eq: () => chain,
      limit: () => chain,
      then: (resolve: (v: { data: ProductRow[]; error: null }) => void) => {
        resolve({ data: rows, error: null });
      },
    };
    return chain;
  };
  return { supabase: { from } as unknown as SupabaseClient<Database>, selects };
}

describe("findSimilarItemsForUser gender wiring", () => {
  const CATALOGUE = [
    product("w-top", { gender: "Female", title: "Quilted Vanity Case" }),
    product("m-shirt", { gender: "Male", title: "Quilted Top-Handle Case" }),
    product("u-scarf", { gender: "Unisex", title: "Quilted Cream Case" }),
  ];

  test("a woman opening the drawer gets women's + Unisex pieces only", async () => {
    const { supabase, selects } = serviceSupabase(
      { shopping_preferences: null, gender: "Female" },
      [...CATALOGUE],
    );
    const results = await findSimilarItemsForUser(supabase, "user-1", {
      attributes: INSPIRATION,
      maxResults: 10,
    });
    expect(results.map((r) => r.id).sort()).toEqual(["u-scarf", "w-top"]);
    // The query itself must ask for gender — the resolution reads it.
    expect(selects).toContain("shopping_preferences,gender");
  });

  test("an ambiguous member gets one consistent direction per hunt, never a mixed list", async () => {
    for (let i = 0; i < 12; i += 1) {
      const { supabase } = serviceSupabase({ shopping_preferences: null, gender: "Non-binary" }, [
        ...CATALOGUE,
      ]);
      const results = await findSimilarItemsForUser(supabase, "user-1", {
        attributes: INSPIRATION,
        maxResults: 10,
      });
      // Unisex is always in; exactly ONE directed row joins it — the women's
      // top or the men's shirt, never both.
      const ids = results.map((r) => r.id);
      expect(ids).toContain("u-scarf");
      const directed = ids.filter((id) => id !== "u-scarf");
      expect(directed).toHaveLength(1);
      expect(["w-top", "m-shirt"]).toContain(directed[0]);
    }
  });
});
