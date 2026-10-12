import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createAvailabilityCache, type AvailabilityCache } from "@/lib/availability-cache";
import type { GenerationJobSpec } from "@/lib/generation-jobs.server";
import { isWaveDMissing } from "@/lib/wave-d-availability";

/**
 * Her free check-in each UTC day (Wave D plan, R-2 and Q3), kept in
 * `user_entitlements.free_check_in_on` (20261008090000_quick_rescan_hair_colour.sql,
 * service-role write only). The day is the UTC day, the same reset as daily
 * credits: a member can fake her local timezone, never the server's clock.
 */

type AdminClient = SupabaseClient<Database>;

/** A generation job's free slot: claimed before the job starts (a claimed
 * slot means no charge), handed back when the job fails or is someone
 * else's. */
export type FreeCheckInSlot = NonNullable<GenerationJobSpec<unknown>["freeSlot"]>;

async function serviceRoleClient(): Promise<AdminClient> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

const UTC_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The database's error as a plain Error naming only its code: the raw text
 * is never shown to a member. */
function slotError(op: "claim" | "release", error: { code?: string }): Error {
  const code = error.code ?? "unknown";
  console.error(JSON.stringify({ event: "free_check_in_slot_error", op, code }));
  return new Error(`The free check-in could not be ${op === "claim" ? "claimed" : "returned"}.`);
}

/**
 * Claim: one conditional update that marks today only where today's free
 * check-in is still unclaimed (never claimed, or last claimed on an earlier
 * day), so two requests can never both claim it. Release: hands back today's
 * claim only, never a claim from another day, and only from the request (this
 * slot) whose claim won, at most once per won claim: a request that lost the
 * claim can never free the winner's. A failed claim throws: the request then
 * neither charges nor runs free on a guess.
 */
export function freeCheckInSlot(
  userId: string,
  todayUtc: string,
  admin: () => Promise<AdminClient> = serviceRoleClient,
): FreeCheckInSlot {
  // The day goes into a PostgREST `or` filter: only a plain YYYY-MM-DD.
  if (!UTC_DAY.test(todayUtc)) throw new Error("freeCheckInSlot needs a UTC day (YYYY-MM-DD).");
  let held = false;
  return {
    claim: async () => {
      const db = await admin();
      // src: https://supabase.com/docs/reference/javascript/or · supabase-js 2.110.0
      //   (PostgREST `or=(a.is.null,a.lt.<day>)`; a DATE compares as its ISO text)
      const { data, error } = await db
        .from("user_entitlements")
        .update({ free_check_in_on: todayUtc })
        .eq("user_id", userId)
        .or(`free_check_in_on.is.null,free_check_in_on.lt.${todayUtc}`)
        .select("user_id");
      if (error) throw slotError("claim", error);
      const won = (data?.length ?? 0) > 0;
      if (won) held = true;
      return won;
    },
    release: async () => {
      if (!held) return;
      // Cleared before the write: a second release never sends a second update.
      held = false;
      const db = await admin();
      const { error } = await db
        .from("user_entitlements")
        .update({ free_check_in_on: null })
        .eq("user_id", userId)
        .eq("free_check_in_on", todayUtc);
      if (error) throw slotError("release", error);
    },
  };
}

const instanceAvailability = createAvailabilityCache();

export type CheckInAvailabilityDeps = {
  admin?: () => Promise<AdminClient>;
  cache?: AvailabilityCache;
};

/**
 * Whether Today's check-in can run here: true once `free_check_in_on` exists
 * (the Wave D migration is applied). A missing column is remembered for a few
 * minutes (then asked again, so applying the migration needs no redeploy).
 * Any other failure answers false for this request only. Never throws.
 */
export async function checkInAvailability(deps: CheckInAvailabilityDeps = {}): Promise<boolean> {
  const cache = deps.cache ?? instanceAvailability;
  if (cache.isMissing()) return false;
  try {
    const db = await (deps.admin ?? serviceRoleClient)();
    const { error } = await db.from("user_entitlements").select("free_check_in_on").limit(1);
    if (!error) return true;
    if (isWaveDMissing(error)) {
      cache.markMissing();
      console.warn(JSON.stringify({ event: "check_in_unavailable", code: error.code ?? null }));
      return false;
    }
    console.error(
      JSON.stringify({ event: "check_in_availability_error", code: error.code ?? null }),
    );
    return false;
  } catch {
    console.error(JSON.stringify({ event: "check_in_availability_error", code: "thrown" }));
    return false;
  }
}
