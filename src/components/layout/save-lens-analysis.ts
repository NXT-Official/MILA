import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type OutfitInsert = Database["public"]["Tables"]["outfits"]["Insert"];

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
  const { data, error } = await db.from("outfits").insert(row).select("id").single();
  if (error || !data) {
    console.error("[lens] couldn't save the analysis:", error?.message);
    return null;
  }
  return { id: data.id };
}
