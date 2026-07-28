import type { SupabaseClient } from "@supabase/supabase-js";
import { IN_FORCE_SUBSCRIPTION_STATUSES } from "@/constants/subscriptions";
import { DEFAULT_AI_CREDITS, InsufficientCreditsError } from "./credits";

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
    .in("status", IN_FORCE_SUBSCRIPTION_STATUSES)
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

export type WithAiCreditOptions<T> = {
  /** For handlers that report failure by returning rather than throwing. */
  refundIf?: (result: T) => boolean;
  consume?: ConsumeCreditStore;
  grant?: GrantCreditStore;
};

/**
 * Charge a credit, run the AI work, put the credit back if the work failed —
 * a provider 5xx, a missing tool_call, a bad lookId. Every AI entry point goes
 * through this: all of those failures tell the client "please try again", so
 * billing for them means a retry loop costs a credit per attempt and returns
 * nothing.
 *
 * ponytail: the refund lands in purchased_credits (grant_ai_credits' only
 * bucket), so a refunded daily credit stops expiring. Harmless at this failure
 * rate; if it ever needs to be exact, give the SQL function a _bucket arg.
 */
export async function withAiCredit<T>(
  supabase: SupabaseClient,
  userId: string,
  produce: () => Promise<T>,
  opts: WithAiCreditOptions<T> = {},
): Promise<T> {
  await consumeAiCredit(supabase, userId, opts.consume);
  const refund = () =>
    grantAiCredits(supabase, userId, 1, opts.grant).catch((err) =>
      // Never let a failed refund mask the failure the caller is reporting.
      console.error("[withAiCredit] refund failed", err),
    );

  let result: T;
  try {
    result = await produce();
  } catch (err) {
    await refund();
    throw err;
  }
  if (opts.refundIf?.(result)) await refund();
  return result;
}

export type LookImageDeps = {
  claim: (userId: string) => Promise<boolean>;
  mark: (userId: string) => Promise<void>;
  consume?: ConsumeCreditStore;
  grant?: GrantCreditStore;
};

/** Single conditional UPDATE: two racing renders can never both claim it. */
async function supabaseClaimLookImage(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_entitlements")
    .update({ look_image_pending: false })
    .eq("user_id", userId)
    .eq("look_image_pending", true)
    .select("user_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Arms the one free image that comes with a just-charged look. */
export async function markLookImagePending(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("user_entitlements")
    .update({ look_image_pending: true })
    .eq("user_id", userId);
  if (error) throw error;
}

const supabaseLookImageDeps: LookImageDeps = {
  claim: supabaseClaimLookImage,
  mark: markLookImagePending,
};

/**
 * The first visual for a freshly generated look is covered by the credit that
 * look already cost; every render after it costs one. A render that comes back
 * without an image costs nothing — whichever way it was paid for is put back,
 * since Cloudflare failing is exactly why the Retry button exists.
 */
export async function payForLookImage<T extends { imageDataUri: string | null }>(
  supabase: SupabaseClient,
  userId: string,
  produce: () => Promise<T>,
  deps: LookImageDeps = supabaseLookImageDeps,
): Promise<T> {
  const free = await deps.claim(userId);
  if (!free) await consumeAiCredit(supabase, userId, deps.consume);

  const result = await produce();

  if (!result.imageDataUri) {
    if (free) await deps.mark(userId);
    else await grantAiCredits(supabase, userId, 1, deps.grant);
  }
  return result;
}
