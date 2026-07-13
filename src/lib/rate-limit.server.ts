/**
 * Server-side sliding-window rate limiter for AI-cost endpoints.
 * Key by authenticated user id (never a client-supplied value).
 *
 * ponytail: per-instance in-memory limiter — resets on redeploy and is not
 * shared across server instances. Good enough for the current single-node
 * deployment; consolidate onto a durable store (Postgres/Upstash) when the
 * broader rate-limiting task lands or the app scales horizontally.
 */

const MAX_TRACKED_KEYS = 10_000;

const buckets = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, stamps] of buckets) {
      if (!stamps.some((t) => t > cutoff)) buckets.delete(k);
    }
  }

  const stamps = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (stamps.length >= limit) {
    buckets.set(key, stamps);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((stamps[0] - cutoff) / 1000)) };
  }
  stamps.push(now);
  buckets.set(key, stamps);
  return { ok: true, retryAfterSeconds: 0 };
}
