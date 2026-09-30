import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type MilaSupabaseClient = SupabaseClient<Database>;

/**
 * The slice of a Paddle transaction this app cares about. Paddle sends the
 * whole entity on `transaction.completed` and returns it from
 * `GET /transactions/{id}`, so the same shape arrives from both paths.
 */
export type CompletedTransaction = {
  id: string;
  status?: string | null;
  subscription_id?: string | null;
  customer_id?: string | null;
  currency_code?: string | null;
  created_at?: string | null;
  billed_at?: string | null;
  invoice_number?: string | null;
  custom_data?: { user_id?: string } | null;
  /** Present on subscription charges: the period the payment covers. */
  billing_period?: { starts_at?: string | null; ends_at?: string | null } | null;
  details?: {
    totals?: {
      grand_total?: string | null;
      total?: string | null;
      tax?: string | null;
    } | null;
  } | null;
  items?: Array<{
    price?: { id?: string | null; description?: string | null } | null;
    product?: { id?: string | null; name?: string | null } | null;
  }> | null;
};

export type PurchaseMetadata = {
  paddle_transaction_id: string;
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  invoice_number: string | null;
  billed_at: string | null;
  receipt_path: string | null;
};

/**
 * Paddle reports totals as integer strings in minor units ("4999" = $49.99).
 * `grand_total` is what was actually charged; `total` is the fallback.
 */
export function transactionAmountCents(transaction: CompletedTransaction): number | null {
  const totals = transaction.details?.totals;
  const raw = totals?.grand_total ?? totals?.total;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export function transactionTaxCents(transaction: CompletedTransaction): number | null {
  const raw = transaction.details?.totals?.tax;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export function purchaseMetadata(transaction: CompletedTransaction): PurchaseMetadata {
  return {
    paddle_transaction_id: transaction.id,
    paddle_subscription_id: transaction.subscription_id ?? null,
    paddle_customer_id: transaction.customer_id ?? null,
    invoice_number: transaction.invoice_number ?? null,
    billed_at: transaction.billed_at ?? transaction.created_at ?? null,
    receipt_path: null,
  };
}

/** A ledger row is only written for money that actually moved. */
export function isRecordableTransaction(transaction: CompletedTransaction): boolean {
  return (
    transaction.status === "completed" &&
    typeof transaction.custom_data?.user_id === "string" &&
    transactionAmountCents(transaction) !== null
  );
}

export type RecordPurchaseResult = {
  /** True when this call wrote the row; false when it was already there. */
  recorded: boolean;
  purchaseId: string | null;
  userId: string | null;
};

/**
 * Claims a completed Paddle transaction in `purchases` — the local ledger the
 * admin console reads. The claim is what makes the receipt email idempotent:
 * Paddle retries webhooks and the checkout return path can race the webhook, so
 * whoever inserts the row is the one that sends the mail.
 *
 * `metadata.paddle_transaction_id` is the identity; it is read back with a
 * PostgREST JSON filter rather than a unique index, because this deployment
 * cannot run DDL migrations (see the repo README).
 */
export async function claimPurchase(
  db: MilaSupabaseClient,
  transaction: CompletedTransaction,
  extras: { productId?: string | null; receiptPath?: string | null } = {},
): Promise<RecordPurchaseResult> {
  const userId = transaction.custom_data?.user_id ?? null;
  if (!isRecordableTransaction(transaction) || !userId) {
    return { recorded: false, purchaseId: null, userId };
  }

  const { data: existing, error: readError } = await db
    .from("purchases")
    .select("id")
    .eq("metadata->>paddle_transaction_id", transaction.id)
    .maybeSingle();
  if (readError) throw new Error(`purchases not read: ${readError.message}`);
  if (existing) return { recorded: false, purchaseId: existing.id, userId };

  const metadata = { ...purchaseMetadata(transaction), receipt_path: extras.receiptPath ?? null };
  const { data: inserted, error: insertError } = await db
    .from("purchases")
    .insert({
      user_id: userId,
      product_id: extras.productId ?? transaction.items?.[0]?.product?.id ?? "paddle_transaction",
      amount_cents: transactionAmountCents(transaction) ?? 0,
      currency: (transaction.currency_code ?? "USD").toUpperCase(),
      status: "completed",
      metadata,
    })
    .select("id")
    .maybeSingle();
  if (insertError) throw new Error(`purchase not recorded: ${insertError.message}`);

  return { recorded: true, purchaseId: inserted?.id ?? null, userId };
}

export async function setPurchaseReceiptPath(
  db: MilaSupabaseClient,
  transactionId: string,
  receiptPath: string,
): Promise<void> {
  const { data: existing } = await db
    .from("purchases")
    .select("id, metadata")
    .eq("metadata->>paddle_transaction_id", transactionId)
    .maybeSingle();
  if (!existing) return;

  const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
  const { error } = await db
    .from("purchases")
    .update({ metadata: { ...metadata, receipt_path: receiptPath } })
    .eq("id", existing.id);
  if (error) throw new Error(`receipt path not stored: ${error.message}`);
}
