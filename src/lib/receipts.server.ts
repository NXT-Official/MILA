import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Mailer } from "./mailer.server";
import { receiptEmail } from "./member-emails";
import { buildReceiptPdf, formatDay, formatMoney, receiptNumber } from "./receipt-pdf.server";
import {
  claimPurchase,
  isRecordableTransaction,
  setPurchaseReceiptPath,
  transactionAmountCents,
  type CompletedTransaction,
} from "./purchases.server";

type MilaSupabaseClient = SupabaseClient<Database>;

export const RECEIPT_BUCKET = "receipts";

export type ReceiptDeps = {
  db: MilaSupabaseClient;
  mail: Mailer;
  now?: () => Date;
  /** Member name + email; the default reads `profiles` and the auth record. */
  loadMember?: (userId: string) => Promise<{ name: string | null; email: string | null }>;
  /** Stores the PDF for the admin console's download link; best effort. */
  uploadReceipt?: (path: string, bytes: Uint8Array) => Promise<boolean>;
};

export type ReceiptOutcome = {
  claimed: boolean;
  emailed: boolean;
  receiptPath: string | null;
  skipped?: string;
  error?: string;
};

export function receiptStoragePath(userId: string, transactionId: string): string {
  return `${userId}/${transactionId}.pdf`;
}

let bucketReady = false;

/** The receipts bucket is created on first use so no migration is needed. */
export async function ensureReceiptBucket(db: MilaSupabaseClient): Promise<boolean> {
  if (bucketReady) return true;
  const { error } = await db.storage.createBucket(RECEIPT_BUCKET, { public: false });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    console.error("[receipts] bucket not created", error.message);
    return false;
  }
  bucketReady = true;
  return true;
}

async function defaultUpload(
  db: MilaSupabaseClient,
  path: string,
  bytes: Uint8Array,
): Promise<boolean> {
  if (!(await ensureReceiptBucket(db))) return false;
  const { error } = await db.storage
    .from(RECEIPT_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) {
    console.error("[receipts] upload failed", error.message);
    return false;
  }
  return true;
}

async function defaultLoadMember(
  db: MilaSupabaseClient,
  userId: string,
): Promise<{ name: string | null; email: string | null }> {
  const [{ data: profile }, userResult] = await Promise.all([
    db.from("profiles").select("full_name,username").eq("id", userId).maybeSingle(),
    db.auth.admin.getUserById(userId),
  ]);
  return {
    name: profile?.full_name ?? profile?.username ?? null,
    email: userResult.data.user?.email ?? null,
  };
}

async function planTitleFor(
  db: MilaSupabaseClient,
  transaction: CompletedTransaction,
): Promise<string> {
  if (transaction.subscription_id) {
    const { data: subscription } = await db
      .from("subscriptions")
      .select("plan_id")
      .eq("paddle_subscription_id", transaction.subscription_id)
      .maybeSingle();
    if (subscription?.plan_id) {
      const { data: plan } = await db
        .from("subscription_plans")
        .select("title")
        .eq("id", subscription.plan_id)
        .maybeSingle();
      if (plan?.title) return plan.title;
    }
  }
  return (
    transaction.items?.[0]?.price?.description ??
    transaction.items?.[0]?.product?.name ??
    "Mila membership"
  );
}

/**
 * Records a completed Paddle payment and emails the member their Mila receipt.
 *
 * The ledger insert is the claim: Paddle retries webhooks and the checkout
 * return path can race the webhook, so exactly one caller records the purchase
 * and sends the mail. Everything after the claim is best effort — a member who
 * paid keeps their ledger row even if storage or mail is having a bad day.
 */
export async function recordPurchaseAndSendReceipt(
  transaction: CompletedTransaction,
  deps: ReceiptDeps,
): Promise<ReceiptOutcome> {
  const now = deps.now?.() ?? new Date();
  const userId = transaction.custom_data?.user_id ?? null;

  if (!isRecordableTransaction(transaction) || !userId) {
    return {
      claimed: false,
      emailed: false,
      receiptPath: null,
      skipped: "not a completed payment",
    };
  }

  const claim = await claimPurchase(deps.db, transaction);
  if (!claim.recorded) {
    return { claimed: false, emailed: false, receiptPath: null, skipped: "already recorded" };
  }

  const amountCents = transactionAmountCents(transaction) ?? 0;
  const currency = (transaction.currency_code ?? "USD").toUpperCase();
  const paidAt = new Date(transaction.billed_at ?? transaction.created_at ?? now.toISOString());
  const periodEnd = transaction.billing_period?.ends_at
    ? new Date(transaction.billing_period.ends_at)
    : null;
  const periodStart = transaction.billing_period?.starts_at
    ? new Date(transaction.billing_period.starts_at)
    : null;
  const number = receiptNumber(transaction.id, now);
  const path = receiptStoragePath(userId, transaction.id);

  let receiptPath: string | null = null;
  let emailed = false;
  let error: string | undefined;

  try {
    const member = await (deps.loadMember
      ? deps.loadMember(userId)
      : defaultLoadMember(deps.db, userId));
    const planTitle = await planTitleFor(deps.db, transaction);

    const pdf = buildReceiptPdf({
      receiptNumber: number,
      issuedAt: now,
      memberName: member.name ?? member.email ?? "Mila member",
      memberEmail: member.email ?? "—",
      planTitle,
      amountCents,
      currency,
      paidAt,
      periodStart,
      periodEnd,
      transactionId: transaction.id,
      invoiceNumber: transaction.invoice_number ?? null,
      billingInterval: null,
    });

    const uploaded = await (deps.uploadReceipt
      ? deps.uploadReceipt(path, pdf)
      : defaultUpload(deps.db, path, pdf));
    if (uploaded) {
      receiptPath = path;
      await setPurchaseReceiptPath(deps.db, transaction.id, path).catch((cause) =>
        console.error("[receipts] receipt path not stored", cause),
      );
    }

    if (member.email) {
      const content = receiptEmail({
        name: member.name,
        planTitle,
        amount: formatMoney(amountCents, currency),
        paidOn: formatDay(paidAt),
        periodEnd: periodEnd ? formatDay(periodEnd) : null,
        receiptNumber: number,
        transactionId: transaction.id,
      });
      const result = await deps.mail.send({
        to: member.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        attachments: [{ filename: `${number}.pdf`, content: pdf }],
      });
      emailed = result.sent;
      if (!result.sent && !result.skipped) error = result.error;
    } else {
      error = "member has no email address";
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    console.error("[receipts] receipt pipeline failed", error);
  }

  return { claimed: true, emailed, receiptPath, error };
}
