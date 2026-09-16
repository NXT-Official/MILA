import { createServerFn } from "@tanstack/react-start";
import { logAiSpend } from "./ai-spend.server";
import { climateForWeatherCode } from "@/constants/climate";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiChatCompletion, aiFailure } from "./ai.server";
import { withAiCredit, markLookImagePending, payForLookImage } from "./credits.server";
import { normalizeBeautyPreferences, formatBeautyPreferencesForPrompt } from "./beauty-preferences";
// TEMPORARY: Cloudflare Flux-1-Schnell (free) stands in for the paid
// OpenRouter provider for demo/stress testing. To revert, point this import
// back at "./openrouter-image.server" — same exported names, no other
// changes needed.
import {
  ImageProviderRateLimitError,
  generateOutfitImage,
  IMAGE_PROVIDER,
  IMAGE_MODEL,
} from "./cloudflare-image.server";
import { errorMessage } from "@/lib/utils";

// Named 2026 haircut trends, sourced from current hairstylist/salon
// coverage (Refinery29 spring/fall 2026 haircut roundups, Pete & Pedro and
// Blumaan men's 2026 look books, WECOLOUR) — not fabricated. Given as
// reference vocabulary so hair recommendations name concrete, currently
// trending cuts instead of a generic silhouette description. The existing
// hair-length rule still governs what's actually achievable.
const HAIRSTYLE_TRENDS_2026: Record<string, string[]> = {
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
const UNISEX_HAIRSTYLE_TRENDS_2026 = [
  "Wolf Cut",
  "Textured Crop",
  "Modern Shag",
  "Birkin Bangs",
  "Curtain Fringe",
];

const Input = z.object({
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
  .handler(async ({ data, context }): Promise<DailyLook> => {
    return withAiCredit(context.supabase, context.userId, async () => {
      const { data: profileRow } = await context.supabase
        .from("profiles")
        .select(
          "beauty_preferences,gender,makeup_preference,hair_length,skin_depth,height_cm,weight_kg",
        )
        .eq("id", context.userId)
        .maybeSingle();

      const beautyPreferences = normalizeBeautyPreferences(profileRow?.beauty_preferences);
      const makeupEnabled = computeMakeupEligibility({
        gender: profileRow?.gender,
        makeup_preference: profileRow?.makeup_preference,
      });
      const hairLengthValue = profileRow?.hair_length?.trim() || null;
      const genderValue =
        profileRow?.gender && profileRow.gender !== "Prefer not to say" ? profileRow.gender : null;
      const skinDepthValue = profileRow?.skin_depth?.trim() || null;
      const heightCm = profileRow?.height_cm ?? null;
      const weightKg = profileRow?.weight_kg ?? null;

      let tempF = data.tempF;
      let tempC = data.tempC;
      let condition = data.condition;
      let forecastRetrievedAt: string | null = null;
      if ((tempF == null || !condition) && data.lat != null && data.lon != null) {
        try {
          const r = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${data.lat}&longitude=${data.lon}&current=temperature_2m,weather_code,wind_speed_10m`,
          );
          const j = (await r.json()) as {
            current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
          };
          const c = Math.round(j?.current?.temperature_2m ?? 20);
          const code = j?.current?.weather_code ?? 2;
          const wind = Math.round(j?.current?.wind_speed_10m ?? 0);
          tempC = tempC ?? c;
          tempF = tempF ?? Math.round((c * 9) / 5 + 32);
          condition ??= climateForWeatherCode(code, wind).condition;
          forecastRetrievedAt = new Date().toISOString();
        } catch (err) {
          console.warn("Open-Meteo fetch failed; falling back to label only.", err);
        }
      }

      const tempLine =
        tempF != null
          ? `${tempF}°F (${tempC ?? Math.round(((tempF - 32) * 5) / 9)}°C)`
          : data.weather;
      const conditionLine = condition ?? "Mixed";
      const locationLine = data.location ?? "the user's location";

      const beautyPrefsLine = formatBeautyPreferencesForPrompt(beautyPreferences);

      const faceShapeValue = data.faceShape?.trim() || null;
      const hairTypeValue = data.hairType?.trim() || null;
      const colorSeasonValue = data.colorSeason?.trim();
      if (!colorSeasonValue) throw new Error("Color season missing from profile.");
      if (!data.bodyType?.trim())
        throw new Error("Body type missing from profile. Complete your Studio dossier first.");

      const profileLines = [
        genderValue
          ? `- Gender presentation: ${genderValue} (AUTHORITATIVE — garment types, cuts, and silhouettes must suit this presentation; for Non-binary favor gender-neutral/androgynous silhouettes; never default to a gendered assumption otherwise)`
          : null,
        `- Body type: ${data.bodyType}`,
        heightCm != null || weightKg != null
          ? `- Build: ${[heightCm != null ? `${heightCm}cm` : null, weightKg != null ? `${weightKg}kg` : null].filter(Boolean).join(", ")} (use this only to inform proportion/scale language — e.g. petite framing, elongating lines, tailored volume — never restate these numbers back in the output)`
          : null,
        `- 16-season color profile: ${colorSeasonValue} (AUTHORITATIVE — every color reference in outfit/hair/makeup MUST be drawn from this exact season; do NOT substitute a different season name)`,
        data.skinUndertone ? `- Skin undertone: ${data.skinUndertone}` : null,
        skinDepthValue
          ? `- Skin depth: ${skinDepthValue} (combine with undertone above when judging color contrast, saturation, and finish choices)`
          : null,
        faceShapeValue
          ? `- Face shape: ${faceShapeValue} (use this exact face-shape name in the hair rationale)`
          : null,
        hairTypeValue
          ? `- Hair type: ${hairTypeValue} (use this exact hair-type name in the hair rationale)`
          : null,
        hairLengthValue ? `- Current hair length: ${hairLengthValue}` : null,
        `- Beauty preferences: ${beautyPrefsLine}`,
      ]
        .filter(Boolean)
        .join("\n");

      const hairLengthRule = hairLengthValue
        ? hairLengthValue === "Bald/Shaved"
          ? " The client is bald/shaved — do not prescribe any hairstyle; keep 'style' and 'execution_tip' focused on scalp care or a grooming note instead."
          : ` The client's current hair length is ${hairLengthValue} — recommend ONLY styles achievable at this length. Never assume added length, extensions, or a different length than what's stated.`
        : "";

      const trendList =
        genderValue === "Male" || genderValue === "Female"
          ? HAIRSTYLE_TRENDS_2026[genderValue]
          : UNISEX_HAIRSTYLE_TRENDS_2026;
      const trendLine = ` Draw from named 2026 trending cuts where they fit — e.g. ${trendList.join(", ")} — adapted to the length/type/face-shape constraints below; don't force a fit if none of these suit the client's stated length or type.`;

      const hairRule =
        (faceShapeValue && hairTypeValue
          ? `- HAIR (CROSS-REFERENCE REQUIRED): the 'style' MUST be a specific silhouette engineered for BOTH the user's hair type (${hairTypeValue}) AND face shape (${faceShapeValue}). Reference the face shape "${faceShapeValue}" by name inside the rationale. Name the silhouette concretely (parting, length, volume placement, finish). Explain in one clause how it balances the ${faceShapeValue} face shape. NEVER prescribe a silhouette that fights the hair type. The 'execution_tip' must name a specific product class, tool size, or technique appropriate to ${hairTypeValue} hair.`
          : hairTypeValue
            ? `- HAIR: prescribe a concrete silhouette appropriate to ${hairTypeValue} hair (parting, length, volume placement, finish). The 'execution_tip' must name a specific product class, tool size, or technique appropriate to ${hairTypeValue} hair.`
            : faceShapeValue
              ? `- HAIR: prescribe a concrete silhouette that flatters a ${faceShapeValue} face shape; reference it by name in the rationale. Name the silhouette concretely and give one execution tip.`
              : `- HAIR: prescribe a concrete silhouette (parting, length, volume placement, finish) plus one execution tip.`) +
        trendLine +
        hairLengthRule;

      const systemPrompt = `You are an elite head-to-toe stylist composing one cohesive Daily Look — outfit + hair + makeup — from first principles. NOT from any inventory.

CLIENT PROFILE:
${profileLines}

LOCAL WEATHER (authoritative — do not override):
- Location: ${locationLine}
- Temperature: ${tempLine}
- Condition: ${conditionLine}
- Verbal summary: ${data.weather}

HARD CLIMATE RULES (non-negotiable):
- Under 55°F (≈13°C): prescribe structural outerwear and layering — coats, blazers, overshirts, mid- or heavy-weight knits, scarves.
- Over 75°F (≈24°C): omit heavy layers entirely. Prefer lightweight breathable fabrics, short sleeves, airy silhouettes.
- Between 55–75°F: light layering is welcome.
- Rain: water-resistant outerwear, darker bottoms, closed footwear; skip suede.
- Snow: insulated outerwear and boots only.
- Windy: structured wind-breaking layer; avoid voluminous silhouettes.
- Sunny + warm: lighter colors and breathable weaves.

OCCASION VIBE: ${data.vibe}
${
  data.agenda || data.dressCode || data.indoorOutdoor
    ? `
TODAY'S AGENDA (when present, this is more specific than the vibe above and takes priority for occasion-appropriateness — do not contradict it):
${data.agenda ? `- Plan: ${data.agenda}` : ""}
${data.dressCode ? `- Dress code: ${data.dressCode}` : ""}
${data.indoorOutdoor ? `- Setting: ${data.indoorOutdoor}` : ""}`
    : ""
}

RULES:
- OUTFIT: write a vivid 'headline', a 2-4 sentence 'description' that names main garments (fabrics, colors, silhouettes harmonized with the ${colorSeasonValue} palette and flattering a ${data.bodyType} figure), and short 'styling_notes' (cuffs, tucking, layering tweaks).
${hairRule}
${
  makeupEnabled
    ? `- MAKEUP (PALETTE LOCKED TO 16-SEASON PROFILE): the 'palette' MUST anchor strictly inside the ${colorSeasonValue} season family and the palette sentence MUST contain the literal string "${colorSeasonValue}". Do NOT name any other season (no "Muted Summer" if the user is "${colorSeasonValue}", etc.). Do not borrow tones from the opposing axis. The 'details' must specify (1) base finish texture, (2) precise placement, and (3) finish/wear. Cross-reference beauty preferences (${beautyPrefsLine}) when choosing finish.`
    : "- MAKEUP: do not include makeup guidance — this client has makeup disabled."
}
- Be specific, shoppable, executable. Do NOT reference any owned wardrobe.
- Tone: read like a luxury fashion editorial — confident, precise, never generic.

Always call the report_daily_look tool.`;

      const composed = await aiChatCompletion(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Compose today's complete look." },
        ],
        buildDailyLookTool(makeupEnabled),
        { supabase: context.supabase, userId: context.userId },
      );
      const failure = "Mila couldn't compose a look this time. Please try again.";
      if (!composed.ok) throw aiFailure(composed.status, failure);

      // Force makeup to null when disabled regardless of what the model
      // returned — the tool schema already omits it, but this is the hard
      // server-side boundary, not a suggestion to the model.
      const argsWithMakeup = {
        ...(composed.args as Record<string, unknown>),
        makeup: makeupEnabled ? ((composed.args as Record<string, unknown>).makeup ?? null) : null,
        forecastRetrievedAt,
      };
      const look = DailyLookSchema.safeParse(argsWithMakeup);
      if (!look.success) throw new Error(failure);
      // The credit charged above covers this look's first visual, rendered by the
      // separate regenerateOutfitImage call the client makes next.
      await markLookImagePending(context.userId);
      return look.data;
    });
  });

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
    payForLookImage(context.supabase, context.userId, async () => {
      try {
        const { data: profileRow } = await context.supabase
          .from("profiles")
          .select("gender,skin_depth")
          .eq("id", context.userId)
          .maybeSingle();
        const { imageUrl, costUsd, promptTokens, completionTokens, totalTokens } =
          await generateOutfitImage(data, {
            gender: profileRow?.gender,
            skinDepth: profileRow?.skin_depth,
          });
        await logAiSpend(context.supabase, context.userId, {
          provider: IMAGE_PROVIDER,
          model: IMAGE_MODEL,
          costUsd,
          promptTokens,
          completionTokens,
          totalTokens,
        });
        return { imageDataUri: imageUrl };
      } catch (error) {
        console.error("[generateOutfitImage] failed:", errorMessage(error, "Unknown error"));
        return {
          imageDataUri: null,
          // Surface the specific reason (site-wide quota vs. provider rate
          // limit) rather than a one-size-fits-all message — both messages
          // from cloudflare-image.server.ts are already user-appropriate.
          imageGenerationError:
            error instanceof ImageProviderRateLimitError
              ? error.message
              : "The outfit was created, but its visual could not be generated.",
        };
      }
    }),
  );
