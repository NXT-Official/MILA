import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiChatCompletion } from "./ai.server";
import { consumeAiCredit } from "./credits.server";
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";
import { normalizeBeautyPreferences, formatBeautyPreferencesForPrompt } from "./beauty-preferences";
import { generateOutfitImage, isCloudflareRateLimitError } from "./cloudflare-image.server";

const GENERATE_LOOK_LIMIT = 10;
const GENERATE_LOOK_WINDOW_SECONDS = 60 * 60;

// beautyPreferences is deliberately NOT part of this client-supplied input:
// it's untrusted personalization data, so the handler loads it itself from
// the authenticated user's profile (see below) instead of trusting whatever
// shape the browser sends. bodyType/colorSeason/etc. remain client-supplied
// for now — hardening those the same way is a separate, larger change.
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
});

const tool = {
  type: "function" as const,
  function: {
    name: "report_daily_look",
    description:
      "Compose a complete head-to-toe daily look: outfit, hair, and makeup — from first principles, harmonized to the client's profile, weather, and vibe.",
    parameters: {
      type: "object",
      properties: {
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
        makeup: {
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
        },
        vibe_alignment_score: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description:
            "Integer 1-10 rating how confidently this composition hits the requested Occasion Vibe.",
        },
      },
      required: ["outfit", "hair", "makeup", "vibe_alignment_score"],
      additionalProperties: false,
    },
  },
};

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
  makeup: z.object({
    palette: z.string().min(1),
    details: z.string().min(1),
  }),
  vibe_alignment_score: z.number().int().min(1).max(10),
});
export type DailyLook = z.infer<typeof DailyLookSchema>;

/**
 * The complete client-side result: the written look plus its visual (or why
 * it's missing). Assembled client-side from two calls — generateDailyLook
 * (Gemini) then regenerateOutfitImage (Cloudflare) — so the dashboard can
 * render the written outfit the moment it's ready instead of waiting on the
 * image too.
 */
export type GeneratedLook = DailyLook & {
  imageDataUri: string | null;
  imageGenerationError?: string;
};

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Maps an image-generation failure to a friendly, credential-free message for the UI. */
function friendlyImageError(err: unknown): string {
  if (isCloudflareRateLimitError(err)) {
    return "The visual service is temporarily busy. Your written outfit is still available.";
  }
  return "The outfit was created, but its visual could not be generated.";
}

/** Generates the outfit visual from an already-validated Gemini result; never throws. */
async function tryGenerateOutfitImage(
  outfit: DailyLook,
): Promise<{ imageDataUri: string | null; imageGenerationError?: string }> {
  try {
    const imageDataUri = await generateOutfitImage(outfit);
    return { imageDataUri };
  } catch (error) {
    console.error(
      "[generateOutfitImage] failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { imageDataUri: null, imageGenerationError: friendlyImageError(error) };
  }
}

export const generateDailyLook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = Input.safeParse(input);
    if (!parsed.success) {
      // Safe to log in full: this input is occasion/weather/profile-shape
      // strings, never credentials or tokens.
      console.error("[generateDailyLook] invalid input", parsed.error.flatten());
      throw new Error("Mila couldn't prepare your style profile for this look. Please try again.");
    }
    return parsed.data;
  })
  .handler(async ({ data, context }): Promise<DailyLook> => {
    try {
      await consumeRateLimit(
        `ai:generateDailyLook:${context.userId}`,
        GENERATE_LOOK_LIMIT,
        GENERATE_LOOK_WINDOW_SECONDS,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }
    await consumeAiCredit(context.supabase, context.userId);

    const { data: profileRow, error: profileError } = await context.supabase
      .from("profiles")
      .select("beauty_preferences")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileError) {
      console.error("[generateDailyLook] failed to load beauty preferences", profileError);
    }
    const beautyPreferences = normalizeBeautyPreferences(profileRow?.beauty_preferences);

    let tempF = data.tempF;
    let tempC = data.tempC;
    let condition = data.condition;
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
        if (!condition) {
          if ([71, 73, 75, 77, 85, 86].includes(code)) condition = "Snow";
          else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code))
            condition = "Rain";
          else if (code === 0 || code === 1) condition = "Sunny";
          else if (wind >= 25) condition = "Windy";
          else if (code === 3 || [45, 48].includes(code)) condition = "Overcast";
          else condition = "Cloudy";
        }
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
      `- Body type: ${data.bodyType}`,
      `- 16-season color profile: ${colorSeasonValue} (AUTHORITATIVE — every color reference in outfit/hair/makeup MUST be drawn from this exact season; do NOT substitute a different season name)`,
      data.skinUndertone ? `- Skin undertone: ${data.skinUndertone}` : null,
      faceShapeValue
        ? `- Face shape: ${faceShapeValue} (use this exact face-shape name in the hair rationale)`
        : null,
      hairTypeValue
        ? `- Hair type: ${hairTypeValue} (use this exact hair-type name in the hair rationale)`
        : null,
      `- Beauty preferences: ${beautyPrefsLine}`,
    ]
      .filter(Boolean)
      .join("\n");

    const hairRule =
      faceShapeValue && hairTypeValue
        ? `- HAIR (CROSS-REFERENCE REQUIRED): the 'style' MUST be a specific silhouette engineered for BOTH the user's hair type (${hairTypeValue}) AND face shape (${faceShapeValue}). Reference the face shape "${faceShapeValue}" by name inside the rationale. Name the silhouette concretely (parting, length, volume placement, finish). Explain in one clause how it balances the ${faceShapeValue} face shape. NEVER prescribe a silhouette that fights the hair type. The 'execution_tip' must name a specific product class, tool size, or technique appropriate to ${hairTypeValue} hair.`
        : hairTypeValue
          ? `- HAIR: prescribe a concrete silhouette appropriate to ${hairTypeValue} hair (parting, length, volume placement, finish). The 'execution_tip' must name a specific product class, tool size, or technique appropriate to ${hairTypeValue} hair.`
          : faceShapeValue
            ? `- HAIR: prescribe a concrete silhouette that flatters a ${faceShapeValue} face shape; reference it by name in the rationale. Name the silhouette concretely and give one execution tip.`
            : `- HAIR: prescribe a concrete silhouette (parting, length, volume placement, finish) plus one execution tip.`;

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

RULES:
- OUTFIT: write a vivid 'headline', a 2-4 sentence 'description' that names main garments (fabrics, colors, silhouettes harmonized with the ${colorSeasonValue} palette and flattering a ${data.bodyType} figure), and short 'styling_notes' (cuffs, tucking, layering tweaks).
${hairRule}
- MAKEUP (PALETTE LOCKED TO 16-SEASON PROFILE): the 'palette' MUST anchor strictly inside the ${colorSeasonValue} season family and the palette sentence MUST contain the literal string "${colorSeasonValue}". Do NOT name any other season (no "Muted Summer" if the user is "${colorSeasonValue}", etc.). Do not borrow tones from the opposing axis. The 'details' must specify (1) base finish texture, (2) precise placement, and (3) finish/wear. Cross-reference beauty preferences (${beautyPrefsLine}) when choosing finish.
- Be specific, shoppable, executable. Do NOT reference any owned wardrobe.
- Tone: read like a luxury fashion editorial — confident, precise, never generic.

Always call the report_daily_look tool.`;

    const res = await aiChatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Compose today's complete look." },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "report_daily_look" } },
    });

    if (res.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Please try again later.");
    if (!res.ok) {
      const t = await res.text();
      console.error("AI provider error", res.status, t);
      throw new Error("Couldn't generate today's look.");
    }

    const json = await res.json();
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("AI did not return a selection.");

    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(stripMarkdownFences(call.function.arguments));
    } catch (err) {
      console.error("[generateDailyLook] AI returned non-JSON arguments", err);
      throw new Error("Mila couldn't compose a look this time. Please try again.");
    }

    const look = DailyLookSchema.safeParse(parsedArgs);
    if (!look.success) {
      console.error("[generateDailyLook] AI response failed validation", look.error.flatten());
      throw new Error("Mila couldn't compose a look this time. Please try again.");
    }
    return look.data;
  });

/**
 * Regenerates only the visual for an already-generated outfit — does not
 * call Gemini again. Powers the dashboard's "Retry visual" action.
 */
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
  .handler(async ({ data }) => tryGenerateOutfitImage(data));
