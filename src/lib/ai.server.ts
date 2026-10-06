import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiSpend } from "./ai-spend.server";
import { DEFAULT_AI_TEXT_MODEL, resolveTextModel } from "./platform-settings.server";
import { errorMessage } from "./utils";

export interface AiCallerContext {
  supabase: SupabaseClient;
  userId: string;
}

export type AiTool = { function: { name: string; parameters: Record<string, unknown> } };

export type AiResult =
  { ok: true; args: unknown } | { ok: false; status: number; modelRejected?: boolean };

/** Optional per-call controls. Absent fields keep the shipped defaults, so
 * every pre-existing caller behaves exactly as before. */
export interface AiChatOptions {
  /** Pin a specific model for this call instead of reading the platform
   * setting. Production callers leave it unset (the admin console decides);
   * the regression tests use it to exercise the rejected-model fallback. */
  model?: string;
  /** Per-attempt budget for the whole request INCLUDING the body read. */
  timeoutMs?: number;
  /** OpenRouter reasoning budget, in tokens. The big compose calls otherwise
   * spend ~10k reasoning tokens to produce a ~1.5k answer (observed), which
   * dominates both latency and cost and widens the window for provider
   * stalls. Calls that pass this bounded reasoning still returned a full,
   * valid payload in live probes. */
  reasoningMaxTokens?: number;
}

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
// Every image-generation call in this codebase bounds its OpenRouter fetch
// with this same timeout — this was the one call site missing it. Confirmed
// live: with no timeout, a slow/stuck OpenRouter response left the look-
// generation server function running indefinitely with no user-visible
// feedback beyond the client's own generic timeout toast, and the server
// call kept consuming function time (and, if it eventually succeeded, a
// credit) after the client had already given up.
//
// Raised 75s -> 110s (2026-10-05): the look pipeline's review and plan calls
// run 12-14k-token prompts with 5-9k-token completions, and on a slow
// provider night calls that normally finish inside a minute were aborting
// mid-body at 75s ("provider response body failed timed out mid-body"),
// failing the whole generation with the generic retry message. 110s per
// call x the two sequential compose stages stays inside the dashboard's
// compose budget (LOOK_TIMEOUT_MS, 240s), so the server still resolves
// before the client gives up.
const TIMEOUT_MS = 110_000;

// The one permanent text/vision brain — multimodal, handles every
// aiChatCompletion caller (text-only look composition and image-bearing
// calls like item detection, personal-color analysis, and photo-edit
// verification) without a separate vision model. Staff can switch it at
// runtime from the admin console (platform_settings, read through
// resolveTextModel below); this constant is the shipped default and the
// fallback, so bumping it here changes what a fresh or unreachable settings
// row deploys with.
export const TEXT_MODEL = DEFAULT_AI_TEXT_MODEL;
export const TEXT_PROVIDER = "openrouter";

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function aiFailure(status: number, fallback: string): Error {
  if (status === 429) return new Error("Rate limit reached. Please try again in a moment.");
  if (status === 402) return new Error("AI credits exhausted. Please try again later.");
  return new Error(fallback);
}

function stripJsonFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
}

/** Each complete top-level `{…}` in `text`, in order. Quotes are tracked only
 * inside an object, so prose around it can't flip the string state. */
function* topLevelObjects(text: string): Generator<string> {
  let depth = 0;
  let start = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = depth > 0;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) yield text.slice(start, i + 1);
    }
  }
}

function tryParseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

/**
 * The JSON in a model reply. Structured output is requested, but not every
 * provider behind a model enforces it, so the object can also arrive after a
 * reasoning block or inside a sentence of prose (fenced or not). In order:
 *   1. the reply as-is (bare or fenced), so a valid reply is never altered;
 *   2. the reply with reasoning blocks dropped — an unfinished one to the
 *      end, never mined for a draft;
 *   3. an object found in the prose, only when EXACTLY ONE complete
 *      top-level object parses. A draft and a final answer side by side are
 *      refused, not guessed between (some callers read `passes === true`
 *      without a schema), and a truncated reply never yields a nested
 *      fragment of itself.
 * Throws when there is no single JSON answer to take.
 */
function parseModelJson(text: string): unknown {
  const asIs = tryParseJson(stripJsonFence(text));
  if (asIs) return asIs.value;

  const body = stripJsonFence(text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, ""));
  const withoutReasoning = tryParseJson(body);
  if (withoutReasoning) return withoutReasoning.value;

  const found = Array.from(topLevelObjects(body), tryParseJson).filter(
    (parsed): parsed is { value: unknown } => parsed !== null,
  );
  if (found.length === 1) return found[0].value;
  throw new SyntaxError(`Expected one JSON object in the reply, found ${found.length}`);
}

/** True when the provider rejected the MODEL ID itself — a typo'd or retired
 * model — as opposed to any other failure. OpenRouter answers these with a
 * 400/404 whose body names the model (e.g. "No endpoints found for …").
 * Exported for the regression tests. */
export function isModelRejection(status: number, bodyText: string): boolean {
  return (
    (status === 400 || status === 404) &&
    /model/i.test(bodyText) &&
    /not found|no endpoints|does not exist|unknown|invalid/i.test(bodyText)
  );
}

/**
 * One chat completion on one model. Callers go through
 * {@link aiChatCompletion}, which owns model resolution and the
 * rejected-model fallback.
 */
async function requestCompletion(
  model: string,
  messages: Array<Record<string, unknown>>,
  tool: AiTool,
  caller: AiCallerContext,
  options: AiChatOptions,
  apiKey: string,
  timeoutMs: number,
): Promise<AiResult> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        ...(options.reasoningMaxTokens
          ? { reasoning: { max_tokens: options.reasoningMaxTokens } }
          : {}),
        response_format: {
          type: "json_schema",
          json_schema: { name: tool.function.name, schema: tool.function.parameters, strict: true },
        },
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    console.error("[ai] provider request failed or timed out", errorMessage(err, "unknown"));
    return { ok: false, status: 504 };
  }
  if (!response.ok) {
    const bodyText = await response.text();
    console.error("[ai] provider error", response.status, bodyText);
    return {
      ok: false,
      status: response.status,
      modelRejected: isModelRejection(response.status, bodyText) ? true : undefined,
    };
  }

  // The body read is where a provider that overruns TIMEOUT_MS actually
  // fails: fetch() resolves once the response headers arrive, so the abort
  // (or a dropped/truncated connection) fires while response.json() is in
  // flight — past the fetch try/catch above. Confirmed live: the raw
  // AbortError escaped every caller's error mapping, so a timed-out review
  // call answered the member with INTERNAL/500 instead of the retryable
  // AI_UNAVAILABLE the mobile taxonomy expects.
  let json: {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: {
      cost?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  try {
    json = (await response.json()) as typeof json;
  } catch (err) {
    // Abort rejections may be DOMException (often not `instanceof Error`) —
    // classify by name, not prototype.
    const name =
      typeof (err as { name?: unknown } | null)?.name === "string"
        ? (err as { name: string }).name
        : "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    console.error(
      "[ai] provider response body failed",
      timedOut ? "timed out mid-body" : errorMessage(err, "unknown"),
    );
    return { ok: false, status: timedOut ? 504 : 502 };
  }
  const text = json.choices?.[0]?.message?.content;
  if (!text) {
    console.error("[ai] provider returned no text", JSON.stringify(json).slice(0, 500));
    return { ok: false, status: 502 };
  }

  const usage = json.usage;
  await logAiSpend(caller.supabase, caller.userId, {
    provider: TEXT_PROVIDER,
    model,
    costUsd: typeof usage?.cost === "number" ? usage.cost : null,
    promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : null,
  });

  try {
    return { ok: true, args: parseModelJson(text) };
  } catch {
    // finish_reason "length" = cut off by the token limit, not malformed.
    console.error("[ai] provider returned unparseable JSON", {
      length: text.length,
      finishReason: json.choices?.[0]?.finish_reason,
    });
    return { ok: false, status: 502 };
  }
}

export async function aiChatCompletion(
  messages: Array<Record<string, unknown>>,
  tool: AiTool,
  caller: AiCallerContext,
  options: AiChatOptions = {},
): Promise<AiResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("AI provider not configured — set OPENROUTER_API_KEY");
  }
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  const configuredModel = options.model ?? (await resolveTextModel());
  const result = await requestCompletion(
    configuredModel,
    messages,
    tool,
    caller,
    options,
    apiKey,
    timeoutMs,
  );
  // One retry on the shipped default when the provider rejected the CONFIGURED
  // model id itself (a typo, or a model the provider has retired): a single bad
  // admin setting must not take every AI surface down. Other failures — rate
  // limits, outages, timeouts — are never retried here. (QA F-MA-007.)
  if (!result.ok && result.modelRejected && configuredModel !== TEXT_MODEL) {
    console.error(
      "[ai] configured model was rejected by the provider; retrying with the shipped default",
      TEXT_MODEL,
    );
    const retry = await requestCompletion(
      TEXT_MODEL,
      messages,
      tool,
      caller,
      options,
      apiKey,
      timeoutMs,
    );
    return retry.ok ? retry : { ok: false, status: retry.status };
  }
  return result;
}
