export class RateLimitExceededError extends Error {
  readonly statusCode = 429;
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests. Please try again later.");
    this.name = "RateLimitExceededError";
  }
}

export type RateLimitPolicy = { limit: number; windowSeconds: number };

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  reset_at: string | Date;
  retry_after_seconds: number;
};

export type RateLimitStore = (key: string, policy: RateLimitPolicy) => Promise<RateLimitResult>;

const supabaseRateLimitStore: RateLimitStore = async (key, policy) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .rpc("check_rate_limit", {
      _key: key,
      _limit: policy.limit,
      _window_seconds: policy.windowSeconds,
      _cost: 1,
    })
    .single();
  if (error) throw error;
  return data as RateLimitResult;
};

export async function consumeRateLimit(
  key: string,
  policy: RateLimitPolicy,
  store: RateLimitStore = supabaseRateLimitStore,
) {
  if (!key || policy.limit <= 0 || policy.windowSeconds <= 0) {
    throw new Error("Invalid rate limit configuration");
  }

  let result: RateLimitResult;
  try {
    result = await store(key, policy);
  } catch {
    console.error(JSON.stringify({ event: "rate_limit_store_error", policy: key.split(":")[0] }));
    throw new Error("Request protection is temporarily unavailable.");
  }

  if (!result.allowed) {
    console.warn(JSON.stringify({ event: "rate_limit_block", policy: key.split(":")[0] }));
    throw new RateLimitExceededError(result.retry_after_seconds);
  }
  return result;
}
