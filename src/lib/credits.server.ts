import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_AI_CREDITS, InsufficientCreditsError } from "./credits";

const IN_FORCE_STATUSES = ["active", "trialing", "past_due"];

export type ConsumeCreditStore = (
  userId: string,
  dailyAllowance: number,
) => Promise<{ allowed: boolean; remaining: number }>;

async function resolveDailyCreditAllowance(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan_id")
    .eq("user_id", userId)
    .in("status", IN_FORCE_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return DEFAULT_AI_CREDITS;

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("credits_included")
    .eq("id", sub.plan_id)
    .maybeSingle();
  return plan?.credits_included ?? DEFAULT_AI_CREDITS;
}

async function supabaseConsumeCreditStore(
  userId: string,
  dailyAllowance: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .rpc("consume_ai_credit", { _user_id: userId, _daily_allowance: dailyAllowance })
    .single();
  if (error) throw error;
  return data as { allowed: boolean; remaining: number };
}

export async function consumeAiCredit(
  supabase: SupabaseClient,
  userId: string,
  store: ConsumeCreditStore = supabaseConsumeCreditStore,
): Promise<number> {
  const dailyAllowance = await resolveDailyCreditAllowance(supabase, userId);
  const result = await store(userId, dailyAllowance);
  if (!result.allowed) throw new InsufficientCreditsError();
  return result.remaining;
}

export type GrantCreditStore = (
  userId: string,
  dailyAllowance: number,
  amount: number,
) => Promise<number>;

async function supabaseGrantCreditStore(
  userId: string,
  dailyAllowance: number,
  amount: number,
): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("grant_ai_credits", {
    _user_id: userId,
    _daily_allowance: dailyAllowance,
    _amount: amount,
  });
  if (error) throw error;
  return data as number;
}

export async function grantAiCredits(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  store: GrantCreditStore = supabaseGrantCreditStore,
): Promise<number> {
  const dailyAllowance = await resolveDailyCreditAllowance(supabase, userId);
  return store(userId, dailyAllowance, amount);
}
