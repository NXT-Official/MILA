import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type OutfitInsert = Database["public"]["Tables"]["outfits"]["Insert"];

/**
 * `outfits.match_score` is an INTEGER with a 0-100 CHECK, but the score is
 * whatever the model reported: a float, a value out of range, a string. The
 * read has already cost a credit, so it is made safe here rather than left to
 * fail the insert. Anything that isn't a number at all is stored as no score.
 */
function normalizeMatchScore(value: unknown): number | null {
  const score = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Writes a Lens analysis to the member's history. Resolves to the saved look's
 * id, or null when the row was not written, so the caller never announces a
 * save that didn't happen. Kept out of `app-shell.tsx` so it can be tested
 * without rendering the shell.
 */
export async function saveLensAnalysis(
  db: Pick<SupabaseClient<Database>, "from">,
  row: OutfitInsert,
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from("outfits")
    .insert({ ...row, match_score: normalizeMatchScore(row.match_score) })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[lens] couldn't save the analysis:", error?.message);
    return null;
  }
  return { id: data.id };
}
