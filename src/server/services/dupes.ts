import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  rankDupes,
  type DupeMatch,
  type FindSimilarItemsInputData,
} from "@/lib/dupe-hunter.functions";

type MilaSupabaseClient = SupabaseClient<Database>;

/**
 * Similar catalogue pieces for a garment Mila already catalogued on a post.
 * **Free, no AI call** — the attributes were extracted when the post was
 * analysed, so this is a catalogue query. Shared verbatim by the web
 * `findSimilarItems` server function and the mobile
 * `POST /api/v1/dupes/similar` route.
 */
export async function findSimilarItemsForUser(
  supabase: MilaSupabaseClient,
  data: FindSimilarItemsInputData,
): Promise<DupeMatch[]> {
  return rankDupes(supabase, data.attributes, data.maxResults, data.region);
}
