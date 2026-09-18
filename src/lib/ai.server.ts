import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiSpend } from "./ai-spend.server";

export interface AiCallerContext {
  supabase: SupabaseClient;
  userId: string;
}

export type AiTool = { function: { name: string; parameters: Record<string, unknown> } };

export type AiResult = { ok: true; args: unknown } | { ok: false; status: number };

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

// The one permanent text/vision brain — multimodal, handles every
// aiChatCompletion caller (text-only look composition and image-bearing
// calls like item detection, personal-color analysis, and photo-edit
// verification) without a separate vision model. Bump this one line to
// upgrade; every call site is unaffected.
export const TEXT_MODEL = "deepseek/deepseek-v4.1-flash";
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

export async function aiChatCompletion(
  messages: Array<Record<string, unknown>>,
  tool: AiTool,
  caller: AiCallerContext,
): Promise<AiResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("AI provider not configured — set OPENROUTER_API_KEY");
  }

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: tool.function.name, schema: tool.function.parameters, strict: true },
      },
      usage: { include: true },
    }),
  });
  if (!response.ok) {
    console.error("[ai] provider error", response.status, await response.text());
    return { ok: false, status: response.status };
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      cost?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text) {
    console.error("[ai] provider returned no text", JSON.stringify(json).slice(0, 500));
    return { ok: false, status: 502 };
  }

  const usage = json.usage;
  await logAiSpend(caller.supabase, caller.userId, {
    provider: TEXT_PROVIDER,
    model: TEXT_MODEL,
    costUsd: typeof usage?.cost === "number" ? usage.cost : null,
    promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : null,
  });

  try {
    return { ok: true, args: JSON.parse(stripJsonFence(text)) };
  } catch {
    console.error("[ai] provider returned unparseable JSON", { length: text.length });
    return { ok: false, status: 502 };
  }
}
