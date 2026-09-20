import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateLookForUser } from "@/server/services/look";
import type { LookProduct } from "@/lib/look-products.functions";

// Named 2026 haircut trends, sourced from current hairstylist/salon
// coverage (Refinery29 spring/fall 2026 haircut roundups, Pete & Pedro and
// Blumaan men's 2026 look books, WECOLOUR) — not fabricated. Given as
// reference vocabulary so hair recommendations name concrete, currently
// trending cuts instead of a generic silhouette description. The existing
// hair-length rule still governs what's actually achievable.
export const HAIRSTYLE_TRENDS_2026: Record<string, string[]> = {
  Male: [
    "Textured Crop",
    "Modern Buzz Cut",
    "Overgrown Buzz",
    "Crew Cut",
    "Modern Mullet",
    "Baby Mullet",
    "Wolf Cut",
    "Fab Four Cut",
    "Undercut with a textured top",
    "Low Taper Fade",
    "Man Bun / long-hair revival",
  ],
  Female: [
    "Graduated Bob (Pob)",
    "Varsity Bob",
    "Ripped Bob",
    "Italian Bob",
    "Sculpted French Bob",
    "Baroque Bob",
    "Cloud Bob",
    "Trixie (pixie-bixie hybrid)",
    "Tapered Bixie",
    "Gemini Cut",
    "Chillet (soft mullet)",
    "Tinkerbell Pixie",
    "Curve Cut",
    "J-Shape Haircut",
    "Wolf Cut",
    "Birkin Bangs",
  ],
};
export const UNISEX_HAIRSTYLE_TRENDS_2026 = [
  "Wolf Cut",
  "Textured Crop",
  "Modern Shag",
  "Birkin Bangs",
  "Curtain Fringe",
];

// 2026 fashion micro-trends and the style vibes they read best in, sourced
// from TikTok/runway trend forecasts as of 2026-09-17 (WhoWhatWear, Heuritech,
// Pinterest Predicts) — not fabricated. Refresh quarterly; do not let this go
// stale silently.
export const OUTFIT_TREND_PIECES_2026: string[] = [
  "Boxy cropped camp-collar shirts, worn open over a plain tee or half-buttoned — Korean-minimal streetwear, everyday casual",
  "Wide-leg / baggy straight denim, deliberately oversized through the leg — Y2K revival, streetwear, everyday casual",
  "Loafers or leather derbies styled with denim/casual pieces instead of sneakers — quiet-luxury streetwear crossover, everyday casual, street casual",
  "Deliberate proportion contrast: one boxy/oversized piece (top or bottom) paired with one fitted piece, never both fitted — Korean-minimal streetwear, everyday casual",
  "Wedge heels (understated, patent or satin) — Y2K revival, glam",
  "Napoleon jackets (military shoulders, braiding) — grunge/indie, streetwear",
  "Kangol-style flat caps and bucket hats — streetwear, techwear",
  "Multi-layered tops (stacked tees + collared piece) — 90s-max, streetwear",
  "Culottes (cropped wide-leg) — minimalist, business casual, boho",
  "Toggle-fastening jackets — techwear and minimalist outerwear",
  "Cargo belt bags (wide belt + pockets) — streetwear, techwear, festival",
  "Lace detailing (bandanas, trim, doily-inspired accents) — coquette, glam, street-bride styling",
  "Brooches — old money/quiet luxury, business casual, eveningwear",
  "80s luxury opulence accents (bold shoulders, sheen fabrics) — glam, maximalist",
  "Neo-Chinese / Guochao details (stand collars, frog closures, shorter modern silhouettes) — its own aesthetic, also layers into minimalist or streetwear",
  "Edwardian tailoring (puffed sleeves, princess seams, soft structure) — dark academia, old money",
  "Retro ski aesthetic (fitted silhouettes, graphic lines, saturated color-blocking) — athleisure, streetwear",
  "Modern showgirl (sparkling mesh, feathers, rhinestones in wearable ratio) — glam/eveningwear",
  "Poetcore (soft, literary, flowing pieces) — cottagecore, dark academia",
];

export const Input = z.object({
  bodyType: z.string().min(1).max(64),
  colorSeason: z.string().min(1).max(64),
  skinUndertone: z.string().min(1).max(64).optional().nullable(),
  faceShape: z.string().min(1).max(64).optional().nullable(),
  hairType: z.string().min(1).max(64).optional().nullable(),
  weather: z.string().min(1).max(120),
  tempF: z.number().min(-60).max(140).optional(),
  tempC: z.number().min(-50).max(60).optional(),
  condition: z.enum(["Sunny", "Cloudy", "Overcast", "Rain", "Snow", "Windy"]).optional(),
  location: z.string().min(1).max(120).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  vibe: z.string().min(1).max(64),
  agenda: z.string().min(1).max(200).optional(),
  dressCode: z.string().min(1).max(80).optional(),
  indoorOutdoor: z.enum(["Indoor", "Outdoor", "Mixed"]).optional(),
  timezone: z.string().min(1).max(64).optional(),
  /** ISO 3166-1 alpha-2 country code. Empty/omitted = unknown, don't region-filter shoppable picks. */
  region: z.string().length(2).optional(),
});
export type GenerateLookInputData = z.infer<typeof Input>;

/**
 * Male is always disabled; everyone else needs an explicit non-"none"
 * preference. Computed from the stored profile only — never from client
 * input — so it can't be spoofed by the request payload.
 */
export function computeMakeupEligibility(profile: {
  gender: string | null | undefined;
  makeup_preference: string | null | undefined;
}): boolean {
  return (
    profile.gender !== "Male" && !!profile.makeup_preference && profile.makeup_preference !== "none"
  );
}

export function buildDailyLookTool(makeupEnabled: boolean, candidateProductIds: string[] = []) {
  const properties: Record<string, unknown> = {
    outfit: {
      type: "object",
      properties: {
        headline: {
          type: "string",
          description: "Editorial title, e.g. 'The Architectural Linen Silhouette'.",
        },
        description: {
          type: "string",
          description:
            "Compelling 2-4 sentence breakdown of the main garments composed from first principles — name fabrics, colors, silhouettes.",
        },
        styling_notes: {
          type: "string",
          description:
            "Quick adjustments, e.g. 'Roll cuffs, push up sleeves, half-tuck the shirt'.",
        },
      },
      required: ["headline", "description", "styling_notes"],
      additionalProperties: false,
    },
    hair: {
      type: "object",
      properties: {
        style: {
          type: "string",
          description: "Concrete hairstyle recommendation tuned to hair type + face shape.",
        },
        execution_tip: {
          type: "string",
          description: "Actionable instruction, e.g. 'Prep with mid-weight texture spray'.",
        },
      },
      required: ["style", "execution_tip"],
      additionalProperties: false,
    },
    vibe_alignment_score: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      description:
        "Integer 1-10 rating how confidently this composition hits the requested Occasion Vibe.",
    },
  };
  const required = ["outfit", "hair", "vibe_alignment_score"];

  if (makeupEnabled) {
    properties.makeup = {
      type: "object",
      properties: {
        palette: {
          type: "string",
          description: "Color story harmonized with the user's seasonal palette.",
        },
        details: {
          type: "string",
          description: "Execution steps, e.g. 'Dewy skin base, muted terracotta wash on lids'.",
        },
      },
      required: ["palette", "details"],
      additionalProperties: false,
    };
    required.push("makeup");
  }

  // The enum is the hallucination guard: the model can only name a product_id
  // that's actually a live row from the AVAILABLE INVENTORY prompt block —
  // it can't emit a title, price, or link, so those always come from the
  // server-side DB hydration in look.ts, never from model text.
  if (candidateProductIds.length > 0) {
    properties.shoppable_picks = {
      type: "array",
      items: {
        type: "object",
        properties: {
          product_id: { type: "string", enum: candidateProductIds },
          rationale: {
            type: "string",
            description:
              "One concrete sentence naming why this item suits the client's face shape and skin tone/undertone.",
          },
        },
        required: ["product_id", "rationale"],
        additionalProperties: false,
      },
    };
    required.push("shoppable_picks");
  }

  return {
    function: {
      name: "report_daily_look",
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

export const DailyLookSchema = z.object({
  outfit: z.object({
    headline: z.string().min(1),
    description: z.string().min(1),
    styling_notes: z.string().min(1),
  }),
  hair: z.object({
    style: z.string().min(1),
    execution_tip: z.string().min(1),
  }),
  makeup: z
    .object({
      palette: z.string().min(1),
      details: z.string().min(1),
    })
    .nullable(),
  vibe_alignment_score: z.number().int().min(1).max(10),
  // Server-hydrated real product rows (mirrors LookProduct in
  // look-products.functions.ts) — never the model's raw product_id/rationale
  // output. See RawShoppablePickSchema below for what the model actually emits.
  shoppable_picks: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        brand_id: z.string(),
        category: z.string(),
        price: z.number(),
        currency: z.string(),
        image_url: z.string().nullable(),
        affiliate_link: z.string(),
        verification_status: z.string(),
        last_verified_at: z.string().nullable(),
        rationale: z.string().min(1),
      }),
    )
    .optional(),
  // Set when the live Open-Meteo forecast was actually fetched; null when
  // the weather came from a client-supplied label instead. Not part of what
  // the AI composes — filled in server-side after the tool call.
  forecastRetrievedAt: z.string().nullable().optional(),
});
export type DailyLook = z.infer<typeof DailyLookSchema>;
export type ShoppablePick = NonNullable<DailyLook["shoppable_picks"]>[number];

// What the model itself is allowed to emit for a pick — just an id (schema-
// enum-constrained to real candidates) and a rationale. look.ts hydrates
// this into a full ShoppablePick by joining back to the live DB row.
export const RawShoppablePickSchema = z.object({
  product_id: z.string(),
  rationale: z.string().min(1),
});

/**
 * Joins the model's raw product_id/rationale picks back to real, live DB
 * rows (candidateProducts — already fetched by the caller from
 * matchLookProducts). Any product_id that doesn't match a real candidate is
 * dropped rather than trusted — defense in depth on top of the tool
 * schema's enum constraint, since the final price/link/title the client
 * sees must always come from here, never from model text.
 */
export function hydrateShoppablePicks(
  rawShoppablePicks: unknown,
  candidateProducts: LookProduct[],
): ShoppablePick[] {
  const rawPicksResult = z.array(RawShoppablePickSchema).optional().safeParse(rawShoppablePicks);
  const rawPicks = rawPicksResult.success ? (rawPicksResult.data ?? []) : [];
  return rawPicks
    .map((pick): ShoppablePick | null => {
      const product = candidateProducts.find((p) => p.id === pick.product_id);
      return product ? { ...product, rationale: pick.rationale } : null;
    })
    .filter((pick): pick is ShoppablePick => pick !== null);
}

export type GeneratedLook = DailyLook & {
  imageDataUri: string | null;
  imageGenerationError?: string;
};

export const generateDailyLook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = Input.safeParse(input);
    if (!parsed.success) {
      throw new Error("Mila couldn't prepare your style profile for this look. Please try again.");
    }
    return parsed.data;
  })
  .handler(async ({ data, context }): Promise<DailyLook> =>
    generateLookForUser(context.supabase, context.userId, data),
  );
