import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { consumeAiCredit } from "./credits.server";

const Input = z.object({
  bodyType: z.string().min(1).max(64),
  colorSeason: z.string().min(1).max(64),
  skinUndertone: z.string().min(1).max(64).optional().nullable(),
  faceShape: z.string().min(1).max(64).optional().nullable(),
  hairType: z.string().min(1).max(64).optional().nullable(),
  beautyPreferences: z.record(z.string(), z.unknown()).optional().nullable(),
  weather: z.string().min(1).max(120),
  tempF: z.number().min(-60).max(140).optional(),
  tempC: z.number().min(-50).max(60).optional(),
  condition: z
    .enum(["Sunny", "Cloudy", "Overcast", "Rain", "Snow", "Windy"])
    .optional(),
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
              description: "Quick adjustments, e.g. 'Roll cuffs, push up sleeves, half-tuck the shirt'.",
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

export type DailyLook = {
  outfit: { headline: string; description: string; styling_notes: string };
  hair: { style: string; execution_tip: string };
  makeup: { palette: string; details: string };
  vibe_alignment_score: number;
};

export const generateDailyLook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<DailyLook> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    await consumeAiCredit(context.supabase, context.userId);

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

    const beautyPrefsLine = data.beautyPreferences
      ? JSON.stringify(data.beautyPreferences)
      : "none specified";

    const faceShapeValue = data.faceShape?.trim() || null;
    const hairTypeValue = data.hairType?.trim() || null;
    const colorSeasonValue = data.colorSeason?.trim();
    if (!colorSeasonValue) throw new Error("Color season missing from profile.");
    if (!data.bodyType?.trim()) throw new Error("Body type missing from profile. Complete your Studio dossier first.");

    // Build the profile + hair lines conditionally — no silent "unspecified" placeholders.
    const profileLines = [
      `- Body type: ${data.bodyType}`,
      `- 16-season color profile: ${colorSeasonValue} (AUTHORITATIVE — every color reference in outfit/hair/makeup MUST be drawn from this exact season; do NOT substitute a different season name)`,
      data.skinUndertone ? `- Skin undertone: ${data.skinUndertone}` : null,
      faceShapeValue ? `- Face shape: ${faceShapeValue} (use this exact face-shape name in the hair rationale)` : null,
      hairTypeValue ? `- Hair type: ${hairTypeValue} (use this exact hair-type name in the hair rationale)` : null,
      `- Beauty preferences: ${beautyPrefsLine}`,
    ].filter(Boolean).join("\n");

    const hairRule = (faceShapeValue && hairTypeValue)
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

    // Server-side trace: full prompt + interpolated profile values so we can
    // confirm that the AI is receiving the user's real dossier vectors.
    // eslint-disable-next-line no-console
    console.log("[generateDailyLook] resolved profile inputs", {
      bodyType: data.bodyType,
      colorSeason: colorSeasonValue,
      skinUndertone: data.skinUndertone ?? null,
      faceShape: faceShapeValue,
      hairType: hairTypeValue,
      beautyPreferences: data.beautyPreferences ?? null,
      vibe: data.vibe,
      tempF, tempC, condition, location: locationLine,
    });
    // eslint-disable-next-line no-console
    console.log("[generateDailyLook] full system prompt →\n" + systemPrompt);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Compose today's complete look." },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "report_daily_look" } },
      }),
    });

    if (res.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace settings.");
    if (!res.ok) {
      const t = await res.text();
      console.error("Gateway error", res.status, t);
      throw new Error("Couldn't generate today's look.");
    }

    const json = await res.json();
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("AI did not return a selection.");
    return JSON.parse(call.function.arguments) as DailyLook;
  });
