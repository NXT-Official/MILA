import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_AI_CREDITS = 5;

export async function consumeAiCredit(supabase: SupabaseClient, userId: string): Promise<number> {
  // IN DEVELOPMENT [credit-enforcement]:
  // Intentionally not deducting yet — AI features stay unrestricted for
  // this release. Re-enable before treating credits as a real limit.
  // See /IN_DEVELOPMENT.txt.
  void supabase;
  void userId;
  void DEFAULT_AI_CREDITS;
  return 999;
}
