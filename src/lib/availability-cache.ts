/**
 * Remembers that a not-yet-applied migration is missing for `ttlMs`, then
 * looks again, so applying the migration takes effect without a redeploy.
 *
 * A leaf module (no imports) so every server path that falls back while a
 * migration is missing can share one copy: credits.server.ts uses it, and
 * generation-jobs.server.ts can import it instead of its own copy of the same
 * logic without an import cycle (that module imports credits.server.ts).
 */
export type AvailabilityCache = { isMissing: () => boolean; markMissing: () => void };

export function createAvailabilityCache(
  ttlMs = 5 * 60_000,
  now: () => number = Date.now,
): AvailabilityCache {
  let missingUntil = 0;
  return {
    isMissing: () => now() < missingUntil,
    markMissing: () => {
      missingUntil = now() + ttlMs;
    },
  };
}
