import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { queryKeys } from "@/constants/query-keys";
import { isHairColor, type HairColor } from "@/constants/style-profile/hair-colors";
import { memberAuthorization } from "@/lib/auth-session";
import { memberQueryRetry } from "@/lib/queries/member-query";
import { isWaveDMissing } from "@/lib/wave-d-availability";

/**
 * Her Wave D profile fields in the browser: hair colour, last check-in and
 * whether her founding body scan is used (Wave D plan, section 3.2).
 *
 * These columns come from 20261008090000_quick_rescan_hair_colour.sql, which
 * the owner applies. The main profile read (`profileQueryOptions`) never
 * selects them: a missing column there would break every profile read. They
 * are read only here, under their own query key. A missing column, or a read
 * that finds no row, reads as `available: false`, so every Wave D surface
 * hides itself calmly and nothing ever shows a founding scan as unused.
 */

export type ProfileExtrasClient = SupabaseClient<Database>;

export type ProfileExtrasState = {
  available: boolean;
  hairColor: HairColor | null;
  lastCheckInAt: string | null;
  /** NULL: her once-ever free body scan is still unused. */
  foundingBodyReadAt: string | null;
};

export const PROFILE_EXTRAS_COLUMNS = "hair_color,last_check_in_at,founding_body_read_at";

const UNAVAILABLE: ProfileExtrasState = {
  available: false,
  hairColor: null,
  lastCheckInAt: null,
  foundingBodyReadAt: null,
};

function timestamp(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function profileExtrasQueryOptions(
  userId: string | undefined,
  client: ProfileExtrasClient = supabase,
) {
  return queryOptions({
    queryKey: queryKeys.profileExtras(userId),
    queryFn: async (): Promise<ProfileExtrasState> => {
      if (!userId) return UNAVAILABLE;
      // Read as her, never as anonymous (an anonymous read sees no profile row).
      const authorization = await memberAuthorization(client.auth, userId);
      const { data, error } = await client
        .from("profiles")
        .select(PROFILE_EXTRAS_COLUMNS)
        .eq("id", userId)
        .maybeSingle()
        .setHeader("Authorization", authorization);
      if (error) {
        if (isWaveDMissing(error)) return UNAVAILABLE;
        // Anything else throws, so React Query keeps her last good answer and retries.
        throw error;
      }
      // No row seen: never "available with an unused founding scan".
      if (data === null || typeof data !== "object" || Array.isArray(data)) return UNAVAILABLE;
      const row = data as Record<string, unknown>;
      return {
        available: true,
        hairColor: isHairColor(row.hair_color) ? row.hair_color : null,
        lastCheckInAt: timestamp(row.last_check_in_at),
        foundingBodyReadAt: timestamp(row.founding_body_read_at),
      };
    },
    staleTime: 5 * 60_000,
    retry: memberQueryRetry,
  });
}

/** The only columns `saveProfileExtras` ever sends. */
export const PROFILE_EXTRAS_WRITABLE = [
  "hair_color",
  "last_check_in_at",
  "skin_depth",
  "hair_length",
  "body_type",
] as const;

type WritableColumn = (typeof PROFILE_EXTRAS_WRITABLE)[number];

export type ProfileExtrasPatch = {
  hair_color?: HairColor | null;
  last_check_in_at?: string | null;
  skin_depth?: string | null;
  hair_length?: string | null;
  body_type?: string | null;
};

/**
 * saved: her row changed. not_saved: no row changed (PostgREST answers a
 * zero-row write with success, so only a counted row is a save).
 * unavailable: a Wave D column is not there yet.
 */
export type SaveProfileExtrasOutcome = "saved" | "not_saved" | "unavailable";

/**
 * Writes what she confirmed (a check-in, a hair colour pick) in one update on
 * her own row, then invalidates her profile and her Wave D fields.
 *
 * Only PROFILE_EXTRAS_WRITABLE is sent, whatever else the patch carries; a
 * hair colour must be one of HAIR_COLORS (the database only guards its
 * size). Throws on a real failure, so a caller never confirms a write that
 * did not happen.
 */
// src: https://supabase.com/docs/reference/javascript/update (`update(values, { count })`) ·
//   supabase-js 2.110.0
export async function saveProfileExtras(
  userId: string,
  patch: ProfileExtrasPatch,
  options: { queryClient: QueryClient; client?: ProfileExtrasClient },
): Promise<SaveProfileExtrasOutcome> {
  const client = options.client ?? supabase;
  const source = patch as Record<string, unknown>;
  const update: Partial<Record<WritableColumn, string | null>> = {};
  for (const column of PROFILE_EXTRAS_WRITABLE) {
    if (!Object.prototype.hasOwnProperty.call(source, column)) continue;
    const value = source[column];
    if (value !== null && typeof value !== "string") {
      throw new Error(`saveProfileExtras: ${column} must be text or null`);
    }
    update[column] = value;
  }
  if (update.hair_color != null && !isHairColor(update.hair_color)) {
    throw new Error("saveProfileExtras: hair_color must be one of HAIR_COLORS");
  }
  if (Object.keys(update).length === 0) {
    throw new Error("saveProfileExtras: nothing to save");
  }

  const authorization = await memberAuthorization(client.auth, userId);
  const { error, count } = await client
    .from("profiles")
    .update(update, { count: "exact" })
    .eq("id", userId)
    .setHeader("Authorization", authorization);
  if (error) {
    if (isWaveDMissing(error)) return "unavailable";
    throw error;
  }
  void options.queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
  void options.queryClient.invalidateQueries({ queryKey: queryKeys.profileExtras(userId) });
  return count != null && count > 0 ? "saved" : "not_saved";
}
