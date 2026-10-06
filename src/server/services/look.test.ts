import { describe, expect, mock, test } from "bun:test";

import type { AiResult, AiTool } from "@/lib/ai.server";
import type { withAiCredit } from "@/lib/credits.server";
import type { DailyLook, GenerateLookInputData } from "@/lib/generate-outfit.functions";
import {
  ImageProviderRateLimitError,
  type OutfitImageResult,
  type generateOutfitImage,
} from "@/lib/openrouter-image.server";
import type { payForLookImage } from "@/lib/credits.server";
import { AiUnavailableError } from "@/server/http/api-errors";

import { createRenderBudget } from "./render-budget";
import {
  buildPlanRepairMessage,
  generateLookForUser,
  planSchemaIssues,
  renderLookImageForUser,
} from "./look";

type QueryResult = { data: unknown; error: { message: string } | null };

/**
 * Minimal thenable PostgREST-style chain, serving only the tables/queries
 * the look services touch: the profiles read, the products pages
 * (loadLookInventory), and the ai_spend_log insert. Any other table throws,
 * so a service reaching for something unexpected fails the test loudly.
 */
function chain(result: QueryResult) {
  const q: Record<string, unknown> = {};
  const step = () => q;
  q.select = step;
  q.range = step;
  q.eq = step;
  q.neq = step;
  q.limit = step;
  q.order = step;
  q.maybeSingle = async () => result;
  q.single = async () => result;
  q.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

function supabaseFake(options: {
  profile?: Record<string, unknown> | null;
  categories?: string[];
  productRows?: Array<Record<string, unknown>>;
}) {
  const spendInserts: Array<Record<string, unknown>> = [];
  const profilesResult: QueryResult = { data: options.profile ?? null, error: null };
  const categoriesResult: QueryResult = {
    data: (options.categories ?? []).map((category) => ({ category })),
    error: null,
  };
  const productsResult: QueryResult = { data: options.productRows ?? [], error: null };
  return {
    spendInserts,
    client: {
      from(table: string) {
        if (table === "profiles") {
          return { select: () => chain(profilesResult) };
        }
        if (table === "ai_spend_log") {
          return {
            insert: async (row: Record<string, unknown>) => {
              spendInserts.push(row);
              return { data: null, error: null };
            },
          };
        }
        if (table === "products") {
          return {
            select: (columns: string) =>
              chain(columns === "category" ? categoriesResult : productsResult),
          };
        }
        throw new Error(`unexpected table in test: ${table}`);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// renderLookImageForUser
// ---------------------------------------------------------------------------

const RENDER_PROFILE = { gender: "Female", skin_depth: "Light", height_cm: 168 };

const LOOK_FIXTURE: DailyLook = {
  outfit: { headline: "H", description: "D", styling_notes: "S" },
  hair: { style: "Bun", execution_tip: "Comb" },
  makeup: null,
  vibe_alignment_score: 8,
  fallback_gender_direction: null,
};

function imageResult(): OutfitImageResult {
  return {
    imageUrl: "data:image/jpeg;base64,abc",
    model: "meta/muse-image",
    costUsd: 0.04,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  };
}

// The credit/free-claim wrapper is exercised by credits.server.test.ts — here
// it is a pass-through so the render loop is what's under test.
const passThroughPayFor: typeof payForLookImage = async (_supabase, _userId, produce) => produce();

describe("renderLookImageForUser", () => {
  test("retries a transient provider failure once and returns the render", async () => {
    const fake = supabaseFake({ profile: RENDER_PROFILE });
    const timeouts: Array<number | undefined> = [];
    let calls = 0;
    const generateImage: typeof generateOutfitImage = async (_outfit, deps) => {
      calls += 1;
      timeouts.push(deps?.timeoutMs);
      if (calls === 1) throw new Error("OpenRouter image request failed (502).");
      return imageResult();
    };

    const result = await renderLookImageForUser(fake.client as never, "user-1", LOOK_FIXTURE, {
      generateImage,
      payFor: passThroughPayFor,
    });

    expect(result.imageDataUri).toBe("data:image/jpeg;base64,abc");
    expect(calls).toBe(2);
    expect(timeouts[0]).toBe(75_000);
    expect(fake.spendInserts).toHaveLength(1);
  });

  test("both attempts failing is a partial result, never a thrown error", async () => {
    const fake = supabaseFake({ profile: RENDER_PROFILE });
    let calls = 0;
    const generateImage: typeof generateOutfitImage = async () => {
      calls += 1;
      throw new Error("timeout");
    };

    const result = await renderLookImageForUser(fake.client as never, "user-1", LOOK_FIXTURE, {
      generateImage,
      payFor: passThroughPayFor,
    });

    expect(result.imageDataUri).toBeNull();
    expect(result.imageGenerationError).toBe(
      "The outfit was created, but its visual could not be generated.",
    );
    expect(calls).toBe(2);
    expect(fake.spendInserts).toHaveLength(0);
  });

  test("a rate limit is not retried and its message is surfaced", async () => {
    const fake = supabaseFake({ profile: RENDER_PROFILE });
    let calls = 0;
    const generateImage: typeof generateOutfitImage = async () => {
      calls += 1;
      throw new ImageProviderRateLimitError("OpenRouter rate limit reached.");
    };

    const result = await renderLookImageForUser(fake.client as never, "user-1", LOOK_FIXTURE, {
      generateImage,
      payFor: passThroughPayFor,
    });

    expect(result.imageDataUri).toBeNull();
    expect(result.imageGenerationError).toBe("OpenRouter rate limit reached.");
    expect(calls).toBe(1);
  });

  test("a second attempt starts only when the remaining budget can carry it", async () => {
    const fake = supabaseFake({ profile: RENDER_PROFILE });
    let elapsed = 0;
    const budget = createRenderBudget(150_000, () => elapsed);
    let calls = 0;
    const generateImage: typeof generateOutfitImage = async () => {
      calls += 1;
      // Simulate a stalled attempt that eats almost the whole budget.
      elapsed += 145_000;
      throw new Error("timeout");
    };

    const result = await renderLookImageForUser(fake.client as never, "user-1", LOOK_FIXTURE, {
      generateImage,
      payFor: passThroughPayFor,
      budget,
    });

    expect(calls).toBe(1);
    expect(result.imageDataUri).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateLookForUser — schema-repair retry
// ---------------------------------------------------------------------------

const COMPOSE_INPUT: GenerateLookInputData = {
  bodyType: "Hourglass",
  colorSeason: "True Winter",
  skinUndertone: "Cool",
  faceShape: "Oval",
  hairType: "Straight",
  weather: "Mild and sunny",
  tempF: 70,
  condition: "Sunny",
  vibe: "casual",
};

const COMPOSE_PROFILE = {
  beauty_preferences: null,
  gender: "Female",
  makeup_preference: "none",
  hair_length: "Medium",
  skin_depth: "Light",
  height_cm: 165,
  weight_kg: null,
  color_profile: null,
  color_season: "True Winter",
  skin_undertone: "Cool",
};

function productRow(n: number) {
  return {
    id: `p${n}`,
    title: `Test Piece ${n}`,
    brand_id: "brand-1",
    category: "Tops",
    price: 100 + n,
    currency: "USD",
    image_url: null,
    affiliate_link: `https://shop.example/p${n}`,
    description: `A well-cut top number ${n}.`,
    seasonal_palettes: ["True Winter"],
    body_shapes: ["Hourglass"],
    available_regions: [],
    verification_status: "verified",
    last_verified_at: null,
    in_stock: true,
    gender: "Female",
    attire: ["Casual"],
  };
}

const REVIEW_OK: AiResult = {
  ok: true,
  args: { shortlist: [0, 1, 2, 3, 4, 5].map((item) => ({ item })) },
};

/** Missing `hair` entirely — DailyLookSchema rejects it. */
const INVALID_PLAN_ARGS = {
  outfit: {
    headline: "The Test Look",
    description: "A concise description.",
    styling_notes: "Roll the cuffs.",
  },
  vibe_alignment_score: 8,
};

/** `hair.style` is an empty string — the other class of schema rejection. */
const INVALID_PLAN_ARGS_2 = {
  outfit: {
    headline: "The Test Look",
    description: "A concise description.",
    styling_notes: "Roll the cuffs.",
  },
  hair: { style: "", execution_tip: "Smooth with a brush." },
  vibe_alignment_score: 8,
};

const VALID_PLAN_ARGS = {
  outfit: {
    headline: "The Test Look",
    description: "A concise description.",
    styling_notes: "Roll the cuffs.",
  },
  hair: { style: "Low sleek bun", execution_tip: "Smooth with a boar-bristle brush." },
  vibe_alignment_score: 8,
  shoppable_picks: [{ product_id: "p0", rationale: "Suits the palette." }],
};

type RecordedCall = { messages: Array<Record<string, unknown>>; tool: AiTool };

function fakeAi(
  responses: AiResult[],
  calls: RecordedCall[],
): typeof import("@/lib/ai.server").aiChatCompletion {
  return async (messages, tool) => {
    calls.push({ messages, tool });
    const next = responses.shift();
    if (!next) throw new Error("fakeAi: no scripted response left");
    return next;
  };
}

// withAiCredit's consume/refund behavior is exercised by credits.server.test.ts
// with its own stores — here it is a pass-through so the compose flow is what's
// under test.
const passThroughWithCredit: typeof withAiCredit = async (_supabase, _userId, produce) => produce();

function composeFakes() {
  return supabaseFake({
    profile: COMPOSE_PROFILE,
    categories: ["Tops"],
    productRows: [0, 1, 2, 3, 4, 5].map(productRow),
  });
}

describe("generateLookForUser schema repair", () => {
  test("a schema-invalid plan output is repaired with one re-ask, not failed", async () => {
    const calls: RecordedCall[] = [];
    const fake = composeFakes();
    const ai = fakeAi(
      [REVIEW_OK, { ok: true, args: INVALID_PLAN_ARGS }, { ok: true, args: VALID_PLAN_ARGS }],
      calls,
    );
    const markPending = mock(async () => {});

    const look = await generateLookForUser(fake.client as never, "user-1", COMPOSE_INPUT, {
      ai,
      withCredit: passThroughWithCredit,
      markPending,
    });

    expect(look.outfit.headline).toBe("The Test Look");
    expect(look.shoppable_picks?.map((pick) => pick.id)).toEqual(["p0"]);
    expect(calls).toHaveLength(3);
    expect(calls[0].tool.function.name).toBe("report_inventory_shortlist");
    expect(calls[2].tool.function.name).toBe("report_daily_look");
    const repairMessage = String(
      (calls[2].messages[calls[2].messages.length - 1] as { content?: unknown }).content,
    );
    expect(repairMessage).toContain("rejected by schema validation");
    expect(repairMessage).toContain("hair");
    expect(markPending).toHaveBeenCalledTimes(1);
  });

  test("a valid plan output on the first try never triggers a repair call", async () => {
    const calls: RecordedCall[] = [];
    const fake = composeFakes();
    const ai = fakeAi([REVIEW_OK, { ok: true, args: VALID_PLAN_ARGS }], calls);

    const look = await generateLookForUser(fake.client as never, "user-1", COMPOSE_INPUT, {
      ai,
      withCredit: passThroughWithCredit,
      markPending: async () => {},
    });

    expect(look.outfit.headline).toBe("The Test Look");
    expect(calls).toHaveLength(2);
  });

  test("when the repair attempt also fails validation the error still surfaces", async () => {
    const calls: RecordedCall[] = [];
    const fake = composeFakes();
    const ai = fakeAi(
      [REVIEW_OK, { ok: true, args: INVALID_PLAN_ARGS }, { ok: true, args: INVALID_PLAN_ARGS_2 }],
      calls,
    );

    const promise = generateLookForUser(fake.client as never, "user-1", COMPOSE_INPUT, {
      ai,
      withCredit: passThroughWithCredit,
      markPending: async () => {},
    });

    await expect(promise).rejects.toBeInstanceOf(AiUnavailableError);
    expect(calls).toHaveLength(3);
  });

  test("an unavailable review degrades to the deterministic shortlist, not a failure", async () => {
    const calls: RecordedCall[] = [];
    const fake = composeFakes();
    const ai = fakeAi(
      [
        { ok: false, status: 504 },
        { ok: false, status: 504 },
        { ok: true, args: VALID_PLAN_ARGS },
      ],
      calls,
    );

    const look = await generateLookForUser(fake.client as never, "user-1", COMPOSE_INPUT, {
      ai,
      withCredit: passThroughWithCredit,
      markPending: async () => {},
    });

    expect(look.outfit.headline).toBe("The Test Look");
    expect(calls).toHaveLength(3);
    expect(calls[0].tool.function.name).toBe("report_inventory_shortlist");
    expect(calls[2].tool.function.name).toBe("report_daily_look");
  });
});

describe("plan repair helpers", () => {
  test("planSchemaIssues formats path and message per issue", () => {
    expect(
      planSchemaIssues({
        issues: [
          { path: ["hair", "style"], message: "Required" },
          { path: [], message: "Bad payload" },
        ],
      }),
    ).toEqual(["hair.style: Required", "(root): Bad payload"]);
  });

  test("buildPlanRepairMessage lists every issue and the correction instruction", () => {
    const message = buildPlanRepairMessage([
      "hair: Required",
      "vibe_alignment_score: Expected number",
    ]);
    expect(message).toContain("- hair: Required");
    expect(message).toContain("- vibe_alignment_score: Expected number");
    expect(message).toContain("rejected by schema validation");
    expect(message).toContain("report_daily_look");
  });
});
