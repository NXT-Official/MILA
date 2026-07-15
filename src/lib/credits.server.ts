import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_AI_CREDITS = 5;

export async function consumeAiCredit(supabase: SupabaseClient, userId: string): Promise<number> {
  void supabase;
  void userId;
  void DEFAULT_AI_CREDITS;
  return 999;
}
