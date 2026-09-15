import type { SupabaseClient } from "@supabase/supabase-js";

export interface AiSpendRecord {
  provider: string;
  model: string;
  costUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

// Best-effort: a failed spend-log insert must never break the caller's response.
export async function logAiSpend(
  supabase: SupabaseClient,
  userId: string,
  record: AiSpendRecord,
): Promise<void> {
  const { error } = await supabase.from("ai_spend_log").insert({
    user_id: userId,
    provider: record.provider,
    model: record.model,
    cost_usd: record.costUsd,
    prompt_tokens: record.promptTokens,
    completion_tokens: record.completionTokens,
    total_tokens: record.totalTokens,
  });
  if (error) console.error("[logAiSpend] insert failed:", error.message);
}
