import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IN_FORCE_SUBSCRIPTION_STATUSES,
  isStaffGrantedSubscription,
} from "@/constants/subscriptions";
import type { Database } from "@/integrations/supabase/types";
import {
  applyPaddleSubscriptionEvent,
  type PaddleSubscriptionWebhookEvent,
} from "@/lib/paddle-webhook.server";

type MilaSupabaseClient = SupabaseClient<Database>;
type PaddleSubscription = PaddleSubscriptionWebhookEvent["data"];

/** Ids per `in (...)` filter, kept small enough for a PostgREST URL. */
const BATCH_SIZE = 200;

/**
 * The calendar date the credit RPCs use: `consume_ai_credit` compares
 * `credits_reset_at` against `CURRENT_DATE`, which is UTC in this project, so
 * the sweep must use the same clock or it would top members up twice a day.
 */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type MaintenanceSubscription = {
  user_id: string;
  plan_id: string | null;
  status: string;
  paddle_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
};

export type TopUpGroup = { credits: number; userIds: string[] };

/**
 * Today's allowance per member, grouped so each distinct allowance is one
 * update. A member with more than one live row keeps the best allowance rather
 * than whichever row happened to come back first.
 */
export function planTopUpGroups(
  subscriptions: MaintenanceSubscription[],
  planCredits: Map<string, number>,
): TopUpGroup[] {
  const best = new Map<string, number>();
  for (const subscription of subscriptions) {
    if (!subscription.plan_id) continue;
    const credits = planCredits.get(subscription.plan_id);
    if (credits === undefined) continue;
    best.set(subscription.user_id, Math.max(best.get(subscription.user_id) ?? 0, credits));
  }

  const byCredits = new Map<number, string[]>();
  for (const [userId, credits] of best) {
    byCredits.set(credits, [...(byCredits.get(credits) ?? []), userId]);
  }
  return [...byCredits].map(([credits, userIds]) => ({ credits, userIds }));
}

export type StaleSubscription =
  | { kind: "ended"; subscription: MaintenanceSubscription }
  | { kind: "reconcile"; subscription: MaintenanceSubscription };

/**
 * Live subscriptions whose paid period has already ended. One the member
 * cancelled is simply over — nothing Paddle can say would keep it alive — while
 * a renewing one is only stale because its renewal webhook never arrived, so it
 * is reconciled against Paddle before anything is decided about it.
 */
export function classifyStaleSubscriptions(
  subscriptions: MaintenanceSubscription[],
  now: Date,
): StaleSubscription[] {
  const stale: StaleSubscription[] = [];
  for (const subscription of subscriptions) {
    const end = subscription.current_period_end
      ? Date.parse(subscription.current_period_end)
      : Number.NaN;
    if (Number.isNaN(end) || end >= now.getTime()) continue;
    stale.push({
      kind: subscription.cancel_at_period_end ? "ended" : "reconcile",
      subscription,
    });
  }
  return stale;
}

export type MembershipMaintenanceDeps = {
  db: MilaSupabaseClient;
  now?: () => Date;
  /** Paddle lookup, absent when no API key is configured — the sweep then only ends rows it can prove are over. */
  fetchSubscription?: (subscriptionId: string) => Promise<PaddleSubscription | null>;
  applySubscriptionEvent?: typeof applyPaddleSubscriptionEvent;
};

export type MembershipMaintenanceSummary = {
  date: string;
  live: number;
  toppedUp: number;
  ended: number;
  reconciled: number;
  skipped: number;
  errors: string[];
};

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function loadLiveSubscriptions(db: MilaSupabaseClient): Promise<MaintenanceSubscription[]> {
  const { data, error } = await db
    .from("subscriptions")
    .select(
      "user_id, plan_id, status, paddle_subscription_id, current_period_end, cancel_at_period_end",
    )
    .in("status", IN_FORCE_SUBSCRIPTION_STATUSES);
  if (error) throw new Error(`subscriptions not read: ${error.message}`);
  return data ?? [];
}

/**
 * Daily membership sweep: give every live subscriber today's styling credits,
 * and take subscriptions that are over out of force so tomorrow's sweep skips
 * them. Idempotent — running it twice in a day changes nothing the second time,
 * which is what makes it safe to retry.
 */
export async function runMembershipMaintenance(
  deps: MembershipMaintenanceDeps,
): Promise<MembershipMaintenanceSummary> {
  const now = deps.now?.() ?? new Date();
  const applyEvent = deps.applySubscriptionEvent ?? applyPaddleSubscriptionEvent;
  const today = utcDate(now);
  const errors: string[] = [];

  // Sweep first, top up second: a subscription that ends today must not also
  // collect today's allowance on its way out.
  const beforeSweep = await loadLiveSubscriptions(deps.db);
  const stale = classifyStaleSubscriptions(beforeSweep, now);
  let ended = 0;
  let reconciled = 0;
  let skipped = 0;

  for (const item of stale) {
    const subscriptionId = item.subscription.paddle_subscription_id;

    if (item.kind === "ended") {
      const { error } = await deps.db
        .from("subscriptions")
        .update({ status: "canceled", cancel_at_period_end: false })
        .eq("paddle_subscription_id", subscriptionId ?? "");
      if (error) {
        errors.push(`end ${subscriptionId}: ${error.message}`);
        continue;
      }
      ended += 1;
      continue;
    }

    if (!deps.fetchSubscription || !subscriptionId || isStaffGrantedSubscription(subscriptionId)) {
      // Two reasons to leave a row alone: a granted plan is staff-managed and
      // has no Paddle subscription to ask about, and without a Paddle key a
      // renewing row can't be verified — a paid-up member must not be
      // downgraded on a guess.
      skipped += 1;
      continue;
    }

    try {
      const paddleSubscription = await deps.fetchSubscription(subscriptionId);
      if (!paddleSubscription) {
        skipped += 1;
        continue;
      }
      await applyEvent(deps.db, { event_type: "subscription.updated", data: paddleSubscription });
      reconciled += 1;
    } catch (error) {
      errors.push(`reconcile ${subscriptionId}: ${error instanceof Error ? error.message : error}`);
      skipped += 1;
    }
  }

  // Re-read: the sweep may have just taken rows out of force, and a reconciled
  // row may have come back cancelled or with a fresh period.
  const live = await loadLiveSubscriptions(deps.db);
  const planIds = [...new Set(live.map((row) => row.plan_id).filter((id): id is string => !!id))];
  const planCredits = new Map<string, number>();
  if (planIds.length > 0) {
    const { data: plans, error } = await deps.db
      .from("subscription_plans")
      .select("id, credits_included")
      .in("id", planIds);
    if (error) throw new Error(`plans not read: ${error.message}`);
    for (const plan of plans ?? []) {
      planCredits.set(plan.id, plan.credits_included ?? 0);
    }
  }

  const groups = planTopUpGroups(live, planCredits);
  const userIds = [...new Set(live.map((row) => row.user_id))];
  const alreadyReset = new Set<string>();
  for (const batch of chunk(userIds, BATCH_SIZE)) {
    const { data, error } = await deps.db
      .from("user_entitlements")
      .select("user_id, credits_reset_at")
      .in("user_id", batch);
    if (error) throw new Error(`entitlements not read: ${error.message}`);
    for (const row of data ?? []) {
      if (row.credits_reset_at === today) alreadyReset.add(row.user_id);
    }
  }

  let toppedUp = 0;
  for (const group of groups) {
    const owed = group.userIds.filter((userId) => !alreadyReset.has(userId));
    if (owed.length === 0) continue;
    for (const batch of chunk(owed, BATCH_SIZE)) {
      const { error } = await deps.db
        .from("user_entitlements")
        .update({ ai_credits: group.credits, credits_reset_at: today })
        .in("user_id", batch);
      if (error) {
        errors.push(`top up ${group.credits} credits: ${error.message}`);
        continue;
      }
      toppedUp += batch.length;
    }
  }

  return { date: today, live: live.length, toppedUp, ended, reconciled, skipped, errors };
}
