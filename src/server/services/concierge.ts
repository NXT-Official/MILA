import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { HUBS } from "@/constants/climate";
import { aiChatCompletion } from "@/lib/ai.server";
import { withAiCredit } from "@/lib/credits.server";
import {
  GENERATION_DEADLINE_SECONDS,
  resolveDailyAllowance,
  withGenerationJob,
  withJobId,
  type GenerationJobDeps,
  type GenerationJobContext,
  type GenerationJobRunning,
} from "@/lib/generation-jobs.server";
import { consumeRateLimit } from "@/lib/rate-limit.server";
import { truncateWithEllipsis } from "@/lib/concierge-title";
import type { Json } from "@/integrations/supabase/types";
import {
  saveConciergeTurn,
  type SaveConciergeTurnArgs,
  type SavedConciergeTurn,
} from "./concierge-turns";
import { deriveColorMetrics } from "@/lib/profile-color";
import { normalizeBeautyPreferences } from "@/lib/beauty-preferences";
import {
  assertTrustedStorageImageUrl,
  isTrustedStorageImageUrl,
} from "@/lib/trusted-image-url.server";
import { AiUnavailableError, DomainValidationError } from "@/server/http/api-errors";
import type { ConciergeChatInputData, ConciergeReply } from "@/lib/concierge-chat.functions";
import { MILA_VOICE } from "@/lib/mila-voice";

type MilaSupabaseClient = SupabaseClient<Database>;

const HISTORY_CHAR_BUDGET = 6000;

const tool = {
  function: {
    name: "report_concierge_reply",
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

/** The member-facing message for every reply that could not be produced. */
export const CONCIERGE_FAILURE_MESSAGE = "Mila couldn't respond just now. Please try again.";

/** `concierge_messages.content` is capped at 8000 characters. */
export const CONCIERGE_REPLY_MAX_CHARS = 8000;

function capReply(reply: string): string {
  return truncateWithEllipsis(reply, CONCIERGE_REPLY_MAX_CHARS);
}

export type ConciergeDeps = {
  /** The provider chat call: tests inject fakes; production uses aiChatCompletion. */
  ai?: typeof aiChatCompletion;
  /** The legacy credit wrapper, used only while the generation_jobs migration
   * is not applied. */
  withCredit?: typeof withAiCredit;
  jobs?: GenerationJobDeps;
  /** The job's deadline in seconds: tests shorten it; production uses 300. */
  deadlineSeconds?: number;
  dailyAllowance?: (supabase: MilaSupabaseClient, userId: string) => Promise<number>;
  rateLimit?: (key: string) => Promise<unknown>;
  assertImageUrl?: (url: string) => string;
  /** Writes the paid turn into its conversation (service role). */
  saveTurn?: (args: SaveConciergeTurnArgs) => Promise<SavedConciergeTurn>;
};

/** What the Concierge job records as its input: never the chat history, never
 * the idempotency key. */
export function conciergeJobInput(data: ConciergeChatInputData): Json {
  return {
    message: data.message,
    lookId: data.lookId ?? null,
    imageUrl: data.imageUrl ?? null,
    conversationId: data.conversationId ?? null,
    saveTurn: data.saveTurn === true,
  };
}

/** A replayed reply: the stored result, checked before it is trusted. */
export function conciergeFromStored(result: Json | null): ConciergeReply {
  if (!isRecord(result) || typeof result.reply !== "string" || !result.reply) {
    console.error("[conciergeChat] a stored reply no longer validates");
    throw new AiUnavailableError(CONCIERGE_FAILURE_MESSAGE);
  }
  return {
    reply: result.reply,
    conversationId: typeof result.conversationId === "string" ? result.conversationId : null,
    saved: result.saved === true,
  };
}

/**
 * One concierge turn. **1 AI credit**, 20 per 5 minutes. Shared verbatim by the
 * web `conciergeChat` server function and the mobile `POST /api/v1/concierge/chat`
 * route.
 *
 * Runs as a generation job: one charge per `clientRequestId`, the reply stored
 * before she is answered, one refund on any failure. With `saveTurn` the server
 * also writes both sides of the turn into its conversation (creating it when
 * `conversationId` is null), so a paid reply survives a reload or a closed tab;
 * a failed write answers `saved: false` and the client saves as before. While
 * the migration is not applied this is the old `withAiCredit` path, which
 * writes nothing. Chat history reaches the model but is never stored on the
 * job. `inFlight: 'report'` answers `{ status: 'running', jobId }` while another
 * turn is being produced.
 */
export function conciergeChatForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: ConciergeChatInputData,
  options?: { inFlight?: "attach" },
  deps?: ConciergeDeps,
): Promise<ConciergeReply>;
export function conciergeChatForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: ConciergeChatInputData,
  options: { inFlight: "report" },
  deps?: ConciergeDeps,
): Promise<ConciergeReply | GenerationJobRunning>;
export async function conciergeChatForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: ConciergeChatInputData,
  options: { inFlight?: "attach" | "report" } = {},
  deps: ConciergeDeps = {},
): Promise<ConciergeReply | GenerationJobRunning> {
  const ai = deps.ai ?? aiChatCompletion;
  const withCredit = deps.withCredit ?? withAiCredit;
  const assertImageUrl = deps.assertImageUrl ?? assertTrustedStorageImageUrl;
  const saveTurn = deps.saveTurn ?? ((args: SaveConciergeTurnArgs) => saveConciergeTurn(args));
  const dailyAllowanceFor = deps.dailyAllowance ?? resolveDailyAllowance;
  const rateLimit =
    deps.rateLimit ?? ((key: string) => consumeRateLimit(key, { limit: 20, windowSeconds: 300 }));

  await rateLimit(`ai:concierge:${userId}`);

  // Refused before any charge: an untrusted photo, or a conversation that is
  // not hers (the server write re-checks it too).
  if (data.imageUrl) assertImageUrl(data.imageUrl);
  const saving = data.saveTurn === true;
  if (saving && data.conversationId) {
    const { data: owned, error: ownerError } = await supabase
      .from("concierge_conversations")
      .select("id")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (ownerError) {
      console.error("[conciergeChat] failed to check the conversation", ownerError.message);
      throw new DomainValidationError("Mila couldn't open that conversation. Please try again.");
    }
    if (!owned) {
      throw new DomainValidationError("That conversation is no longer available. Start a new one.");
    }
  }

  // The reply, under whichever charge the caller holds. Loads the profile and
  // the anchored look inside it, so a chat about a look that was deleted out
  // from under the client costs nothing.
  const core = async (): Promise<string> => {
    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select(
        "body_type,color_season,skin_undertone,face_shape,hair_type,beauty_preferences,color_profile,default_location",
      )
      .eq("id", userId)
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
      const { data: look, error: lookError } = await supabase
        .from("outfits")
        .select("id,image_url,analysis_result")
        .eq("id", data.lookId)
        .eq("user_id", userId)
        .maybeSingle();
      if (lookError) {
        console.error("[conciergeChat] failed to load look", lookError.message);
        throw new DomainValidationError("Mila couldn't open that saved look. Please try again.");
      }
      if (!look) {
        throw new DomainValidationError(
          "That saved look is no longer available. You can continue without it.",
        );
      }
      lookLines = describeSavedLook(look.analysis_result);
      if (isTrustedStorageImageUrl(look.image_url)) lookImageUrl = look.image_url;
    }

    const attachedImageUrl = data.imageUrl ? assertImageUrl(data.imageUrl) : null;
    const anchored = !!data.lookId;
    const systemPrompt = `You are Mila, a thoughtful personal fashion stylist. You give practical, specific styling advice — outfits, color, proportions, beauty, occasions, packing, wardrobe planning — and always explain briefly why a suggestion works, offering an alternative when useful.

${MILA_VOICE}

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

    const result = await ai(messages, tool, { supabase, userId });
    if (!result.ok) throw new AiUnavailableError(CONCIERGE_FAILURE_MESSAGE);

    const reply = (result.args as { reply?: unknown }).reply;
    if (typeof reply !== "string" || !reply.trim()) {
      throw new AiUnavailableError(CONCIERGE_FAILURE_MESSAGE);
    }
    return capReply(reply.trim());
  };

  const produce = async ({ stillRunning }: GenerationJobContext): Promise<ConciergeReply> => {
    const reply = await core();
    // A produce that outlived its deadline has been failed and refunded: it
    // must not write a conversation she was not charged for. A failed re-read
    // answers false as well, so nothing is written on a guess.
    if (saving && !(await stillRunning())) {
      return { reply, conversationId: data.conversationId ?? null, saved: false };
    }
    if (!saving) return { reply, conversationId: data.conversationId ?? null, saved: false };
    const turn = await saveTurn({
      userId,
      conversationId: data.conversationId ?? null,
      message: data.message,
      imageUrl: data.imageUrl ?? null,
      reply,
    });
    return { reply, conversationId: turn.conversationId, saved: turn.saved };
  };

  const outcome = await withGenerationJob<ConciergeReply>(
    {
      kind: "concierge",
      userId,
      clientRequestId: data.clientRequestId,
      input: conciergeJobInput(data),
      charge: true,
      dailyAllowance: await dailyAllowanceFor(supabase, userId),
      deadlineSeconds: deps.deadlineSeconds ?? GENERATION_DEADLINE_SECONDS,
      inFlight: options.inFlight,
      settle: (value) => ({ ok: true, result: value as Json }),
      fromStored: ({ result }) => conciergeFromStored(result),
      failure: () => {
        throw new AiUnavailableError(CONCIERGE_FAILURE_MESSAGE);
      },
      legacy: () =>
        withCredit(supabase, userId, async () => ({
          reply: await core(),
          conversationId: data.conversationId ?? null,
          saved: false,
        })),
    },
    produce,
    deps.jobs,
  );
  return outcome.status === "running" ? outcome : withJobId(outcome.value, outcome.jobId);
}
