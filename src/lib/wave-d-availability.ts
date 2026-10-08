/**
 * Wave D (Today's check-in, body scan, hair colour) ships with one additive
 * migration, 20261008090000_quick_rescan_hair_colour.sql, which the owner
 * applies. Until then, reading or writing a Wave D column, or calling
 * `release_rate_limit`, fails with one of these codes, and every Wave D
 * surface hides itself instead of showing an error.
 *
 * Pure and dependency-free: mobile copies this file verbatim (same path).
 */

// src: https://docs.postgrest.org/en/v13/references/errors.html (PGRST202 function not found,
//   PGRST204 column not found, PGRST205 table not found, in the schema cache) · PostgREST 13;
//   https://www.postgresql.org/docs/current/errcodes-appendix.html (42P01 undefined_table,
//   42703 undefined_column, 42883 undefined_function)
export const WAVE_D_MISSING_CODES: ReadonlySet<string> = new Set([
  "PGRST202",
  "PGRST204",
  "PGRST205",
  "42P01",
  "42703",
  "42883",
]);

/** The Wave D migration is not applied in this environment. Never throws. */
export function isWaveDMissing(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && WAVE_D_MISSING_CODES.has(code);
}
