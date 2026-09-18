import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { climateForWeatherCode } from "@/constants/climate";
import { logAiSpend } from "@/lib/ai-spend.server";
import { aiChatCompletion } from "@/lib/ai.server";
import { withAiCredit, markLookImagePending, payForLookImage } from "@/lib/credits.server";
import {
  normalizeBeautyPreferences,
  formatBeautyPreferencesForPrompt,
} from "@/lib/beauty-preferences";
import {
  ImageProviderRateLimitError,
  generateOutfitImage,
  IMAGE_PROVIDER,
  IMAGE_MODEL,
} from "@/lib/openrouter-image.server";
import { errorMessage } from "@/lib/utils";
import {
  buildDailyLookTool,
  computeMakeupEligibility,
  DailyLookSchema,
  HAIRSTYLE_TRENDS_2026,
  UNISEX_HAIRSTYLE_TRENDS_2026,
  OUTFIT_TREND_PIECES_2026,
  type DailyLook,
  type GenerateLookInputData,
} from "@/lib/generate-outfit.functions";
import { AiUnavailableError, DomainValidationError } from "@/server/http/api-errors";

type MilaSupabaseClient = SupabaseClient<Database>;

export type LookImageResult = {
  imageDataUri: string | null;
  imageGenerationError?: string;
};

/**
 * Composes today's Daily Look (outfit + hair + makeup) and charges one AI
 * credit. Shared verbatim by the web `generateDailyLook` server function and
 * the mobile `POST /api/v1/look/generate` route — this is the entire body
 * that used to live inside `generateDailyLook`'s handler.
 */
export async function generateLookForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: GenerateLookInputData,
): Promise<DailyLook> {
  return withAiCredit(supabase, userId, async () => {
    const { data: profileRow } = await supabase
      .from("profiles")
      .select(
        "beauty_preferences,gender,makeup_preference,hair_length,skin_depth,height_cm,weight_kg",
      )
      .eq("id", userId)
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
    if (!colorSeasonValue) throw new DomainValidationError("Color season missing from profile.");
    if (!data.bodyType?.trim()) {
      throw new DomainValidationError(
        "Body type missing from profile. Complete your Studio dossier first.",
      );
    }

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
- OUTFIT: write a vivid 'headline', a 2-4 sentence 'description' that names main garments (fabrics, colors, silhouettes harmonized with the ${colorSeasonValue} palette and flattering a ${data.bodyType} figure), and short 'styling_notes' (cuffs, tucking, layering tweaks). Where they fit the requested vibe, draw from current 2026 trending pieces: ${OUTFIT_TREND_PIECES_2026.join("; ")}. Don't force a fit if none of these suit the "${data.vibe}" vibe.
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
      { supabase, userId },
    );
    const failure = "Mila couldn't compose a look this time. Please try again.";
    if (!composed.ok) throw new AiUnavailableError(failure);

    // Force makeup to null when disabled regardless of what the model
    // returned — the tool schema already omits it, but this is the hard
    // server-side boundary, not a suggestion to the model.
    const argsWithMakeup = {
      ...(composed.args as Record<string, unknown>),
      makeup: makeupEnabled ? ((composed.args as Record<string, unknown>).makeup ?? null) : null,
      forecastRetrievedAt,
    };
    const look = DailyLookSchema.safeParse(argsWithMakeup);
    if (!look.success) throw new AiUnavailableError(failure);
    // The credit charged above covers this look's first visual, rendered by the
    // separate renderLookImageForUser call the client makes next.
    await markLookImagePending(userId);
    return look.data;
  });
}

/**
 * Renders (or claims the free first render of) a Daily Look's visual. Shared
 * verbatim by the web `regenerateOutfitImage` server function and the mobile
 * `POST /api/v1/look/image` route.
 *
 * A failed render is not an exception here — it is a first-class partial
 * result (`imageDataUri: null` + `imageGenerationError`), matching what
 * `payForLookImage` needs to decide whether to refund/re-mark the free slot.
 */
export async function renderLookImageForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: DailyLook,
): Promise<LookImageResult> {
  return payForLookImage(supabase, userId, async () => {
    try {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("gender,skin_depth")
        .eq("id", userId)
        .maybeSingle();
      const { imageUrl, costUsd, promptTokens, completionTokens, totalTokens } =
        await generateOutfitImage(data, {
          gender: profileRow?.gender,
          skinDepth: profileRow?.skin_depth,
        });
      await logAiSpend(supabase, userId, {
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
        // from openrouter-image.server.ts are already user-appropriate.
        imageGenerationError:
          error instanceof ImageProviderRateLimitError
            ? error.message
            : "The outfit was created, but its visual could not be generated.",
      };
    }
  });
}
