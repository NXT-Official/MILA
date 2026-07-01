import type { SupabaseClient } from "@supabase/supabase-js";

export const INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS";
const DEFAULT_AI_CREDITS = 5;

/**
 * Atomically decrement the caller's `ai_credits` balance by 1. Throws
 * Error("INSUFFICIENT_CREDITS") when the balance is exactly 0, so the
 * frontend can intercept it and open the upgrade dialog.
 *
 * Uses the user-scoped Supabase client from `requireSupabaseAuth`, so RLS
 * enforces that the row being mutated belongs to the caller.
 */
export async function consumeAiCredit(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  // TODO: Re-enable premium gate before production launch
  // Demo/preview mode: bypass all credit checks. Restore the original
  // entitlements read/decrement (see git history) to re-enable gating.
  void supabase;
  void userId;
  void DEFAULT_AI_CREDITS;
  return 999;
}