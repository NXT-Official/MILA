export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Rate limit reached. Please try again in about ${retryAfterSeconds} seconds.`);
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .rpc("check_rate_limit", { _key: key, _limit: limit, _window_seconds: windowSeconds })
    .single();
  if (error) {
    console.error("[ai-rate-limit] check_rate_limit failed:", error.message);
    throw new Error("Couldn't process your request right now. Please try again.");
  }
  if (!data?.allowed) {
    throw new RateLimitExceededError(data?.retry_after_seconds ?? windowSeconds);
  }
}
