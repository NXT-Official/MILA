import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isHairColor, type HairColor } from "@/constants/style-profile/hair-colors";
import { isWaveDMissing } from "@/lib/wave-d-availability";

/**
 * Her Wave D profile fields, read on the server (Wave D plan, section 3.2).
 *
 * These columns come from 20261008090000_quick_rescan_hair_colour.sql, which
 * the owner applies. They are read here and only here on the server, never
 * through a main profile read, so a missing column can only hide Wave D, not
 * break her profile.
 *
 * Never throws. Fails closed: when the read does not succeed, or finds no
 * row, `available` is false, and callers hide Wave D (a founding body scan is
 * never treated as free because a read failed or saw nothing).
 */

export type ProfileExtras =
  | {
      available: true;
      hairColor: HairColor | null;
      lastCheckInAt: string | null;
      /** NULL: her once-ever free body scan is still unused. */
      foundingBodyReadAt: string | null;
    }
  | {
      available: false;
      /**
       * missing: the migration is not applied here. missing_row: no profile row
       * was found for her. error: the read failed.
       */
      reason: ProfileExtrasUnavailableReason;
      hairColor: null;
      lastCheckInAt: null;
      foundingBodyReadAt: null;
    };

export type ProfileExtrasUnavailableReason = "missing" | "missing_row" | "error";

export const PROFILE_EXTRAS_COLUMNS = "hair_color,last_check_in_at,founding_body_read_at";

function unavailable(reason: ProfileExtrasUnavailableReason): ProfileExtras {
  return {
    available: false,
    reason,
    hairColor: null,
    lastCheckInAt: null,
    foundingBodyReadAt: null,
  };
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function readProfileExtras(
  client: Pick<SupabaseClient<Database>, "from">,
  userId: string,
): Promise<ProfileExtras> {
  try {
    const { data, error } = await client
      .from("profiles")
      .select(PROFILE_EXTRAS_COLUMNS)
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      if (isWaveDMissing(error)) return unavailable("missing");
      console.error(
        JSON.stringify({ event: "profile_extras_read_error", code: error.code ?? null }),
      );
      return unavailable("error");
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      // No row seen: never "available with an unused founding scan".
      console.warn(JSON.stringify({ event: "profile_extras_no_row" }));
      return unavailable("missing_row");
    }
    const row = data as Record<string, unknown>;
    return {
      available: true,
      hairColor: isHairColor(row.hair_color) ? row.hair_color : null,
      lastCheckInAt: timestamp(row.last_check_in_at),
      foundingBodyReadAt: timestamp(row.founding_body_read_at),
    };
  } catch {
    console.error(JSON.stringify({ event: "profile_extras_read_error", code: "thrown" }));
    return unavailable("error");
  }
}
