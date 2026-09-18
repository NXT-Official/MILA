import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateLookForUser, renderLookImageForUser } from "@/server/services/look";

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

export function buildDailyLookTool(makeupEnabled: boolean) {
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
  // Set when the live Open-Meteo forecast was actually fetched; null when
  // the weather came from a client-supplied label instead. Not part of what
  // the AI composes — filled in server-side after the tool call.
  forecastRetrievedAt: z.string().nullable().optional(),
});
export type DailyLook = z.infer<typeof DailyLookSchema>;

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

export const regenerateOutfitImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = DailyLookSchema.safeParse(input);
    if (!parsed.success) {
      console.error("[regenerateOutfitImage] invalid input", parsed.error.flatten());
      throw new Error("Mila couldn't prepare that outfit for a new visual. Please try again.");
    }
    return parsed.data;
  })
  .handler(async ({ data, context }) =>
    renderLookImageForUser(context.supabase, context.userId, data),
  );
