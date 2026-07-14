/**
 * Atomic, durable rate limiting for AI-cost and abuse-prone endpoints.
 *
 * Backed by the `check_rate_limit` Postgres function (see migration
 * 20260714090000_atomic_rate_limits.sql): a single upsert statement that
 * Postgres serializes per key, so concurrent requests at the quota boundary
 * cannot both slip through, and every app instance shares the same counters.
 * Never use src/lib/rate-limit.server.ts's in-memory limiter alone to gate
 * an expensive or abuse-prone server function.
 */

export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Rate limit reached. Please try again in about ${retryAfterSeconds} seconds.`);
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Checks and consumes one unit of `key`'s quota in a single atomic
 * database round trip. Throws RateLimitExceededError when the limit is
 * exceeded, or a generic Error if the check itself fails — this control
 * fails closed rather than silently allowing the request through.
 */
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
