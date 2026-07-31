import type { RateLimitResult, RateLimitStore } from "../../src/lib/rate-limit.server";

export class MemoryRateLimitStore {
  private buckets = new Map<string, { count: number; startedAt: number }>();

  constructor(private now: () => number) {}

  consume: RateLimitStore = async (key, policy) => {
    if (policy.limit <= 0 || policy.windowSeconds <= 0) {
      throw new Error("Invalid rate limit configuration");
    }
    const now = this.now();
    const previous = this.buckets.get(key);
    const expired = !previous || now >= previous.startedAt + policy.windowSeconds * 1000;
    const startedAt = expired ? now : previous.startedAt;
    const count = expired ? 1 : previous.count + 1;
    this.buckets.set(key, { count, startedAt });

    const resetAt = startedAt + policy.windowSeconds * 1000;
    return {
      allowed: count <= policy.limit,
      remaining: Math.max(0, policy.limit - count),
      reset_at: new Date(resetAt),
      retry_after_seconds:
        count > policy.limit ? Math.max(1, Math.ceil((resetAt - now) / 1000)) : 0,
    } satisfies RateLimitResult;
  };
}
