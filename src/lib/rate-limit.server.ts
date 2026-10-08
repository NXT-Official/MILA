import { isWaveDMissing } from "@/lib/wave-d-availability";

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

/**
 * Hands one slot back to the window it was charged in. Resolves true when
 * that window was found, false when it was not (it rolled over, or the key is
 * unknown). Throws the PostgREST error on failure.
 */
export type RateLimitReleaseStore = (key: string, resetAt: string) => Promise<boolean>;

const supabaseRateLimitReleaseStore: RateLimitReleaseStore = async (key, resetAt) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("release_rate_limit", {
    _key: key,
    _reset_at: resetAt,
    _cost: 1,
  });
  if (error) throw error;
  return data === true;
};

let releaseMissingLogged = false;

/**
 * Gives back the hourly slot a read took, when the read did not deliver a new
 * result (Wave D plan, R-2). Only the window that was charged is lowered: the
 * database matches `expires_at` to `resetAt`, so a slot charged before the
 * window rolled over never frees one in the new window.
 *
 * `resetAt` must be the `reset_at` text `consumeRateLimit` returned, passed
 * through untouched: parsing it into a JS Date would drop its microseconds
 * and it would match no window. (A Date, from the in-memory test store, is
 * sent as its ISO text.)
 *
 * Never throws. Until 20261008090000_quick_rescan_hair_colour.sql is applied
 * the function is missing: that is logged once per process and answers
 * false, so the slot stays spent, exactly as before.
 */
export async function releaseRateLimit(
  key: string,
  resetAt: RateLimitResult["reset_at"],
  store: RateLimitReleaseStore = supabaseRateLimitReleaseStore,
): Promise<boolean> {
  const at =
    typeof resetAt === "string"
      ? resetAt
      : resetAt instanceof Date && Number.isFinite(resetAt.getTime())
        ? resetAt.toISOString()
        : "";
  if (!key || !at) return false;
  try {
    return (await store(key, at)) === true;
  } catch (error) {
    const policy = key.split(":")[0];
    if (isWaveDMissing(error)) {
      if (!releaseMissingLogged) {
        releaseMissingLogged = true;
        console.warn(JSON.stringify({ event: "rate_limit_release_unavailable", policy }));
      }
      return false;
    }
    console.error(JSON.stringify({ event: "rate_limit_release_error", policy }));
    return false;
  }
}
