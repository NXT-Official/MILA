import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertTrustedStorageImageUrl } from "./trusted-image-url.server";
import { z } from "zod";
import { aiChatCompletion } from "./ai.server";
import { consumeAiCredit } from "./credits.server";
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";
import { deriveColorMetrics } from "./profile-color";
import { normalizeBeautyPreferences } from "./beauty-preferences";
import { HUBS } from "@/constants/climate";

const HistoryMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

const Input = z.object({
  message: z.string().trim().min(1, "Message is required.").max(2000),
  history: z.array(HistoryMessage).max(12).default([]),
  lookId: z.string().uuid().nullable().optional(),
  imageUrl: z.string().url().max(2048).nullable().optional(),
});

export type ConciergeReply = { reply: string };

const HISTORY_CHAR_BUDGET = 6000;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5 * 60_000;

const tool = {
  type: "function" as const,
  function: {
    name: "report_concierge_reply",
    description: "Return Mila's conversational styling reply.",
    parameters: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description:
            "The complete conversational answer: specific, practical, warm, and grounded in the client's profile. Usually 2-6 sentences; short lists are fine when they help.",
        },
      },
      required: ["reply"],
      additionalProperties: false,
    },
  },
};

function boundHistory(history: Array<{ role: string; content: string }>) {
  const kept: Array<{ role: string; content: string }> = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    used += history[i].content.length;
    if (used > HISTORY_CHAR_BUDGET) break;
    kept.unshift(history[i]);
  }
  return kept;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function describeSavedLook(raw: unknown): string[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!isRecord(value)) return [];

  const lines: string[] = [];
  if (value.type === "daily_look") {
    const outfit = isRecord(value.outfit) ? value.outfit : {};
    const hair = isRecord(value.hair) ? value.hair : {};
    const makeup = isRecord(value.makeup) ? value.makeup : {};
    const headline = str(outfit.headline);
    const description = str(outfit.description);
    const notes = str(outfit.styling_notes);
    if (headline) lines.push(`Look title: ${headline}`);
    if (description) lines.push(`Outfit: ${description}`);
    if (notes) lines.push(`Styling notes: ${notes}`);
    const hairStyle = str(hair.style);
    if (hairStyle) lines.push(`Hair: ${hairStyle}`);
    const palette = str(makeup.palette);
    if (palette) lines.push(`Makeup palette: ${palette}`);
    const vibe = str(value.vibe);
    if (vibe) lines.push(`Occasion vibe: ${vibe}`);
    const weather = str(value.weather);
    if (weather) lines.push(`Weather when composed: ${weather}`);
  } else {
    const verdict = str(value.verdict);
    const colorMatch = str(value.color_match);
    const silhouette = str(value.silhouette);
    if (verdict) lines.push(`Earlier stylist verdict: ${verdict}`);
    if (colorMatch) lines.push(`Earlier color read: ${colorMatch}`);
    if (silhouette) lines.push(`Earlier silhouette read: ${silhouette}`);
  }
  return lines;
}

export const conciergeChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = Input.safeParse(input);
    if (!parsed.success) {
      console.error("[conciergeChat] invalid input", parsed.error.flatten());
      throw new Error("Mila couldn't read that message. Please try again.");
    }
    return parsed.data;
  })
  .handler(async ({ data, context }): Promise<ConciergeReply> => {
    try {
      await consumeRateLimit(`ai:concierge:${context.userId}`, RATE_LIMIT, RATE_WINDOW_MS / 1000);
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }

    await consumeAiCredit(context.supabase, context.userId);

    const { data: profileRow, error: profileError } = await context.supabase
      .from("profiles")
      .select(
        "body_type,color_season,skin_undertone,face_shape,hair_type,beauty_preferences,color_profile,default_location",
      )
      .eq("id", context.userId)
      .maybeSingle();
    if (profileError) {
      console.error("[conciergeChat] failed to load profile", profileError.message);
    }

    const metrics = deriveColorMetrics(profileRow);
    const colorProfile = (profileRow?.color_profile ?? null) as { subSeason?: string } | null;
    const colorSeason = str(colorProfile?.subSeason) ?? metrics.season;
    const beautyPrefs = normalizeBeautyPreferences(profileRow?.beauty_preferences);
    const homeCity = HUBS.find((h) => h.id === profileRow?.default_location)?.city ?? null;

    const profileLines = [
      profileRow?.body_type ? `- Body type: ${profileRow.body_type}` : null,
      colorSeason ? `- Color season: ${colorSeason}` : null,
      metrics.undertone ? `- Skin undertone: ${metrics.undertone}` : null,
      profileRow?.face_shape ? `- Face shape: ${profileRow.face_shape}` : null,
      profileRow?.hair_type ? `- Hair type: ${profileRow.hair_type}` : null,
      beautyPrefs.length ? `- Beauty preferences: ${beautyPrefs.join(", ")}` : null,
      homeCity ? `- Home base: ${homeCity}` : null,
    ].filter(Boolean);

    let lookLines: string[] = [];
    let lookImageUrl: string | null = null;
    if (data.lookId) {
      const { data: look, error: lookError } = await context.supabase
        .from("outfits")
        .select("id,image_url,analysis_result")
        .eq("id", data.lookId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (lookError) {
        console.error("[conciergeChat] failed to load look", lookError.message);
        throw new Error("Mila couldn't open that saved look. Please try again.");
      }
      if (!look) {
        throw new Error("That saved look is no longer available. You can continue without it.");
      }
      lookLines = describeSavedLook(look.analysis_result);
      const trustedPrefix = `${process.env.SUPABASE_URL?.replace(/\/+$/, "")}/storage/v1/object/public/`;
      if (look.image_url?.startsWith(trustedPrefix)) {
        lookImageUrl = look.image_url;
      }
    }

    const attachedImageUrl = data.imageUrl ? assertTrustedStorageImageUrl(data.imageUrl) : null;
    const anchored = !!data.lookId;
    const systemPrompt = `You are Mila, a thoughtful personal fashion stylist. You give practical, specific styling advice — outfits, color, proportions, beauty, occasions, packing, wardrobe planning — and always explain briefly why a suggestion works, offering an alternative when useful.

CLIENT PROFILE (use what's here; if a detail you need is missing, state your assumption or ask ONE focused question — never invent profile facts):
${profileLines.length ? profileLines.join("\n") : "- No style profile on file yet — give great general guidance and state assumptions."}

${
  anchored
    ? `ANCHORED LOOK: the client is asking about one specific saved look.${lookImageUrl ? " Its photo is attached to this conversation." : " Its photo could not be attached — rely on the details below and say so if a visual judgement is asked for."}
${lookLines.length ? lookLines.map((l) => `- ${l}`).join("\n") : "- No structured details available for this look."}
Distinguish clearly between what you can see/know about this look and general guidance.`
    : attachedImageUrl
      ? `The client attached a photo to their latest message — it is included in this conversation. Ground your visual judgements in what the photo actually shows.`
      : `NO IMAGE has been shared in this conversation. Never claim to see an outfit or photo. Answer general styling questions directly and completely — do NOT ask the client to upload a photo unless the question genuinely cannot be answered without one.`
}

RULES:
- Recommendations are options, never rules; no rigid or shaming language, no medical or diagnostic claims.
- Consider weather or location only when it is given above or by the client.
- Do not claim any action was taken outside this chat, and make no purchasing or subscription claims.
- Keep replies focused: usually 2-6 sentences.
- Always call the report_concierge_reply tool.`;

    const history = boundHistory(data.history);

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      ...(lookImageUrl
        ? [
            {
              role: "user" as const,
              content: [
                { type: "text", text: "This is the saved look we're discussing." },
                { type: "image_url", image_url: { url: lookImageUrl } },
              ],
            },
          ]
        : []),
      ...history.map((m) => ({ role: m.role, content: m.content })),
      attachedImageUrl
        ? {
            role: "user",
            content: [
              { type: "text", text: data.message },
              { type: "image_url", image_url: { url: attachedImageUrl } },
            ],
          }
        : { role: "user", content: data.message },
    ];

    const res = await aiChatCompletion({
      messages,
      tools: [tool],
      tool_choice: { type: "function", function: { name: "report_concierge_reply" } },
    });

    if (res.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Please try again later.");
    if (!res.ok) {
      const t = await res.text();
      console.error("AI provider error", res.status, t);
      throw new Error("Mila couldn't respond just now. Please try again.");
    }

    let reply: unknown;
    try {
      const json = await res.json();
      const call = json.choices?.[0]?.message?.tool_calls?.[0];
      reply = call ? JSON.parse(call.function.arguments).reply : null;
    } catch (err) {
      console.error("[conciergeChat] malformed provider response", err);
      throw new Error("Mila couldn't respond just now. Please try again.");
    }
    if (typeof reply !== "string" || !reply.trim()) {
      throw new Error("Mila couldn't respond just now. Please try again.");
    }
    return { reply: reply.trim() };
  });
