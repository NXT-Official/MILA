/**
 * `outfits.match_score` is an INTEGER with a 0-100 CHECK, but the score is
 * whatever the model reported: a float, a value out of range, a string. The
 * read has already cost a credit, so it is made safe here rather than left to
 * fail the insert. Anything that isn't a number at all is stored as no score.
 * Same rule as the copy in `components/layout/save-lens-analysis.ts`.
 */
export function normalizeMatchScore(value: unknown): number | null {
  const score = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  return Math.min(100, Math.max(0, Math.round(score)));
}
