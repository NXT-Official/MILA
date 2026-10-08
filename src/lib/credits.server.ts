import type { SupabaseClient } from "@supabase/supabase-js";
import { IN_FORCE_SUBSCRIPTION_STATUSES, isSubscriptionLive } from "@/constants/subscriptions";
import { createAvailabilityCache, type AvailabilityCache } from "./availability-cache";
import { DEFAULT_AI_CREDITS, InsufficientCreditsError } from "./credits";
import { captureServerException } from "./sentry.server";

export type ConsumeCreditStore = (
  userId: string,
  dailyAllowance: number,
) => Promise<{ allowed: boolean; remaining: number }>;

/** The member's subscription when it is still live, else null. A cancelled
 * subscription keeps its in-force status until Paddle's webhook or the daily
 * sweep catches up, so the paid period being over is what actually decides. */
async function loadLiveSubscription(supabase: SupabaseClient, userId: string) {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan_id, status, current_period_end, cancel_at_period_end")
    .eq("user_id", userId)
    .in("status", IN_FORCE_SUBSCRIPTION_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return sub && isSubscriptionLive(sub) ? sub : null;
}

async function resolveDailyCreditAllowance(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const sub = await loadLiveSubscription(supabase, userId);
  if (!sub) return DEFAULT_AI_CREDITS;

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("credits_included")
    .eq("id", sub.plan_id)
    .maybeSingle();
  return plan?.credits_included ?? DEFAULT_AI_CREDITS;
}

/**
 * True when the member pays for styling: a live subscription, or purchased
 * style credits on hand. These members are bounded by their own credits only —
 * the site-wide daily render quotas exist to cap spend from free accounts and
 * must never block someone who paid. Read BEFORE a credit is consumed, so the
 * member's last purchased credit still counts.
 */
export async function isPaidStyleMember(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  if (await loadLiveSubscription(supabase, userId)) return true;
  const { data: ent } = await supabase
    .from("user_entitlements")
    .select("purchased_credits")
    .eq("user_id", userId)
    .maybeSingle();
  return (ent?.purchased_credits ?? 0) > 0;
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

// ---------------------------------------------------------------------------
// Tracked spend/refund (migration 20261007170000_tracked_ai_credit_refunds)
// ---------------------------------------------------------------------------

/** Which bucket a tracked spend took the credit from, so its refund goes back
 * there. `creditDay` is the UTC day consume_ai_credit stamped. */
export type CreditReceipt = { id: string; bucket: "daily" | "purchased"; creditDay: string };

/** refunded: back in its bucket now · owed: an allowance credit whose day
 * rolled over, landing in the next stamped day's pool (never purchased) ·
 * already_refunded: nothing changed. */
export type TrackedRefundOutcome = "refunded" | "owed" | "already_refunded";

export type TrackedCreditStore = {
  spend: (
    userId: string,
    dailyAllowance: number,
  ) => Promise<{ allowed: boolean; remaining: number; receipt: CreditReceipt | null }>;
  refund: (receiptId: string) => Promise<TrackedRefundOutcome>;
};

/** The tracked migration is not applied yet (function missing). */
export class TrackedCreditsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackedCreditsUnavailableError";
  }
}

/** The shared missing-migration cache (./availability-cache), under the names
 * this module has always exported. */
export type CreditAvailabilityCache = AvailabilityCache;
export const createCreditAvailabilityCache = createAvailabilityCache;

const trackedCreditAvailability = createCreditAvailabilityCache();

// src: https://docs.postgrest.org/en/v12/references/errors.html (PGRST202: function not
//   in the schema cache) · PostgREST 12; PGRST205 (table not in the schema cache) · PostgREST 13
// src: https://www.postgresql.org/docs/current/errcodes-appendix.html (42P01 undefined_table,
//   42883 undefined_function)
const MISSING_CODES = new Set(["PGRST202", "PGRST205", "42P01", "42883"]);

/** A PostgREST error from a tracked RPC as an Error: "migration missing"
 * becomes TrackedCreditsUnavailableError (fall back), anything else keeps the
 * database's message (consume_ai_credit's own errors pass through). */
export function toTrackedCreditsError(
  op: string,
  error: { code?: string; message?: string },
): Error {
  if (error.code && MISSING_CODES.has(error.code)) {
    return new TrackedCreditsUnavailableError(`${op}: ${error.code}`);
  }
  return new Error(error.message ?? `${op} failed`, { cause: error });
}

type RpcError = { code?: string; message?: string };
type RpcResult = PromiseLike<{ data: unknown; error: RpcError | null }>;

/** The slice of a supabase-js (or postgrest-js) client the tracked pair
 * needs, called as a method so the client keeps its `this`. Untyped on
 * purpose: the generated Database types predate the migration, so the rows
 * are checked here instead. */
export type TrackedCreditRpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => RpcResult & { single: () => RpcResult };
};

type TrackedSpendRow = {
  allowed: boolean;
  remaining: number;
  receipt_id: string | null;
  bucket: string | null;
  credit_day: string | null;
};

const REFUND_OUTCOMES = new Set<string>(["refunded", "owed", "already_refunded"]);

/** The tracked pair over a service-role client. */
export function createTrackedCreditStore(
  client: () => Promise<TrackedCreditRpcClient>,
): TrackedCreditStore {
  return {
    spend: async (userId, dailyAllowance) => {
      // src: node_modules/@supabase/postgrest-js · 2.110.0 (rpc on a set-returning
      //   function answers an array; .single() takes its one row, as consume_ai_credit's call does)
      const { data, error } = await (
        await client()
      )
        .rpc("spend_ai_credit_tracked", { p_user_id: userId, p_daily_allowance: dailyAllowance })
        .single();
      if (error) throw toTrackedCreditsError("spend_ai_credit_tracked", error);
      const row = data as TrackedSpendRow | null;
      if (!row?.allowed) return { allowed: false, remaining: 0, receipt: null };
      if (
        !row.receipt_id ||
        (row.bucket !== "daily" && row.bucket !== "purchased") ||
        !row.credit_day
      ) {
        throw new Error("spend_ai_credit_tracked returned no receipt");
      }
      return {
        allowed: true,
        remaining: row.remaining,
        receipt: { id: row.receipt_id, bucket: row.bucket, creditDay: row.credit_day },
      };
    },
    refund: async (receiptId) => {
      const { data, error } = await (
        await client()
      ).rpc("refund_ai_credit_tracked", { p_receipt_id: receiptId });
      if (error) throw toTrackedCreditsError("refund_ai_credit_tracked", error);
      if (typeof data !== "string" || !REFUND_OUTCOMES.has(data)) {
        throw new Error("refund_ai_credit_tracked returned an unknown outcome");
      }
      return data as TrackedRefundOutcome;
    },
  };
}

const supabaseTrackedCreditStore = createTrackedCreditStore(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as TrackedCreditRpcClient;
});

export type WithAiCreditOptions<T> = {
  refundIf?: (result: T) => boolean;
  consume?: ConsumeCreditStore;
  grant?: GrantCreditStore;
  /** The tracked spend/refund pair. Defaults to the database's when no
   * legacy `consume`/`grant` store is injected. */
  tracked?: TrackedCreditStore;
  availability?: CreditAvailabilityCache;
  /** Where server errors are reported. Defaults to Sentry
   * (captureServerException); injectable for tests. */
  report?: (error: unknown) => void;
};

type CreditStores = {
  consume?: ConsumeCreditStore;
  grant?: GrantCreditStore;
  tracked?: TrackedCreditStore;
  availability?: CreditAvailabilityCache;
  report?: (error: unknown) => void;
};

/**
 * Spends one credit and returns how to refund exactly that credit.
 *
 * With the tracked pair (the database's by default) the refund goes back to
 * the bucket the credit came from: purchased to purchased, an allowance
 * credit to the current day's allowance (owed until that day is stamped),
 * never to purchased credits. While the migration is missing, or
 * when only legacy `consume`/`grant` stores are injected, this is today's
 * path unchanged: consume_ai_credit, then grant_ai_credits to refund.
 */
async function spendOneCredit(
  supabase: SupabaseClient,
  userId: string,
  stores: CreditStores,
  label: string,
): Promise<() => Promise<void>> {
  const tracked =
    stores.tracked ?? (stores.consume || stores.grant ? null : supabaseTrackedCreditStore);
  const availability = stores.availability ?? trackedCreditAvailability;

  if (tracked && !availability.isMissing()) {
    const dailyAllowance = await resolveDailyCreditAllowance(supabase, userId);
    let spent: Awaited<ReturnType<TrackedCreditStore["spend"]>> | null = null;
    try {
      spent = await tracked.spend(userId, dailyAllowance);
    } catch (err) {
      // Only "not applied yet" falls back. Any other failure is thrown as is:
      // the spend may have happened, so charging again on the old path could
      // take two credits.
      if (!(err instanceof TrackedCreditsUnavailableError)) throw err;
      availability.markMissing();
      // A fall-back runs the legacy refund path (grant_ai_credits) for
      // the whole miss window, so it must never be silent: once per window
      // per instance, since isMissing() now skips this branch.
      console.warn(
        `[${label}] tracked credit RPCs unavailable; using the old spend/refund path for a few minutes`,
        err,
      );
      (stores.report ?? captureServerException)(err);
    }
    if (spent) {
      if (!spent.allowed || !spent.receipt) throw new InsufficientCreditsError();
      const receiptId = spent.receipt.id;
      return () =>
        tracked.refund(receiptId).then(
          () => undefined,
          (err) => reportRefundFailure(stores, label, err),
        );
    }
  }

  await consumeAiCredit(supabase, userId, stores.consume);
  return () =>
    grantAiCredits(supabase, userId, 1, stores.grant).then(
      () => undefined,
      (err) => reportRefundFailure(stores, label, err),
    );
}

/** A refund that fails leaves the member charged for nothing (Dupe review
 * M3): never only a console line, always error capture too. */
function reportRefundFailure(stores: CreditStores, label: string, err: unknown): void {
  console.error(`[${label}] refund failed`, err);
  (stores.report ?? captureServerException)(err);
}

export async function withAiCredit<T>(
  supabase: SupabaseClient,
  userId: string,
  produce: () => Promise<T>,
  opts: WithAiCreditOptions<T> = {},
): Promise<T> {
  const refund = await spendOneCredit(supabase, userId, opts, "withAiCredit");

  let result: T;
  try {
    result = await produce();
  } catch (err) {
    captureServerException(err);
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
  tracked?: TrackedCreditStore;
  availability?: CreditAvailabilityCache;
  report?: (error: unknown) => void;
};

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

export async function payForLookImage<T extends { imageDataUri: string | null }>(
  supabase: SupabaseClient,
  userId: string,
  produce: () => Promise<T>,
  deps: LookImageDeps = supabaseLookImageDeps,
): Promise<T> {
  const free = await deps.claim(userId);
  const refundCredit = free
    ? null
    : await spendOneCredit(supabase, userId, deps, "payForLookImage");

  const refund = () =>
    refundCredit
      ? refundCredit()
      : deps.mark(userId).catch((err) => reportRefundFailure(deps, "payForLookImage", err));

  let result: T;
  try {
    result = await produce();
  } catch (err) {
    captureServerException(err);
    await refund();
    throw err;
  }

  if (!result.imageDataUri) await refund();
  return result;
}
