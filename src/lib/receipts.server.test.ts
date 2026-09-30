import { describe, expect, mock, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { MailMessage } from "./mailer.server";
import type { CompletedTransaction } from "./purchases.server";
import { recordPurchaseAndSendReceipt, receiptStoragePath } from "./receipts.server";

type Row = Record<string, unknown>;

function fakeDb(config: { existingPurchase?: { id: string } | null; uploadError?: string } = {}) {
  const inserted: Row[] = [];
  const updated: Row[] = [];

  function tableChain(table: string) {
    let mode: "select" | "insert" | "update" = "select";
    const chain = {
      select: () => chain,
      eq: () => chain,
      insert: (values: Row) => {
        mode = "insert";
        inserted.push({ table, ...values });
        return chain;
      },
      update: (values: Row) => {
        mode = "update";
        updated.push({ table, ...values });
        return chain;
      },
      maybeSingle: async () => {
        if (mode === "insert") return { data: { id: "purchase-1" }, error: null };
        if (mode === "update") return { data: null, error: null };
        if (table === "purchases") return { data: config.existingPurchase ?? null, error: null };
        if (table === "profiles") return { data: { full_name: "Nadia Haddad" }, error: null };
        if (table === "subscriptions") return { data: { plan_id: "plan-1" }, error: null };
        if (table === "subscription_plans") return { data: { title: "Style Pro" }, error: null };
        return { data: null, error: null };
      },
    };
    return chain;
  }

  return {
    from: (table: string) => tableChain(table),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "nadia@example.com" } }, error: null }),
      },
    },
    storage: {
      createBucket: async () => ({ data: {}, error: null }),
      from: () => ({
        upload: async (path: string) =>
          config.uploadError
            ? { data: null, error: { message: config.uploadError } }
            : { data: { path }, error: null },
      }),
    },
  } as unknown as SupabaseClient<Database>;
}

function fakeMailer(result: { sent: boolean; skipped?: string; error?: string } = { sent: true }) {
  return { send: mock(async (_message: MailMessage) => result) };
}

const TRANSACTION: CompletedTransaction = {
  id: "txn_01kztk3s79phsrq1e8b76w8a0e",
  status: "completed",
  subscription_id: "sub_01kztk3s79phsrq1e8b76w8a0e",
  customer_id: "ctm_01",
  currency_code: "USD",
  created_at: "2026-09-30T09:15:00.000Z",
  billed_at: "2026-09-30T09:15:00.000Z",
  invoice_number: "MILA-0001234",
  custom_data: { user_id: "user-1" },
  billing_period: { starts_at: "2026-09-30T09:15:00.000Z", ends_at: "2026-10-30T09:15:00.000Z" },
  details: { totals: { grand_total: "4999", total: "4999", tax: "500" } },
  items: [
    {
      price: { id: "pri_1", description: "Style Pro" },
      product: { id: "pro_1", name: "Style Pro" },
    },
  ],
};

const NOW = new Date("2026-09-30T10:00:00.000Z");

describe("recordPurchaseAndSendReceipt", () => {
  test("records the payment, stores the receipt and emails it to the member", async () => {
    const db = fakeDb();
    const mail = fakeMailer();
    const outcome = await recordPurchaseAndSendReceipt(TRANSACTION, {
      db,
      mail: mail as never,
      now: () => NOW,
    });

    expect(outcome).toEqual({
      claimed: true,
      emailed: true,
      receiptPath: receiptStoragePath("user-1", TRANSACTION.id),
    });
    expect(mail.send).toHaveBeenCalledTimes(1);
    const message = mail.send.mock.calls[0][0];
    expect(message.to).toBe("nadia@example.com");
    expect(message.subject).toContain("MILA-2026-6W8A0E");
    expect(message.attachments?.[0].filename).toBe("MILA-2026-6W8A0E.pdf");

    // The attached bytes are a real receipt: a PDF naming the member, the plan
    // and the amount that was charged.
    const pdf = Buffer.from(message.attachments?.[0].content ?? new Uint8Array()).toString(
      "latin1",
    );
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("Nadia Haddad");
    expect(pdf).toContain("Style Pro");
    expect(pdf).toContain("$49.99");
    expect(pdf).toContain("30 Oct 2026");
  });

  test("a retried webhook records nothing and sends nothing", async () => {
    const db = fakeDb({ existingPurchase: { id: "purchase-1" } });
    const mail = fakeMailer();
    const outcome = await recordPurchaseAndSendReceipt(TRANSACTION, {
      db,
      mail: mail as never,
      now: () => NOW,
    });

    expect(outcome).toMatchObject({ claimed: false, emailed: false, skipped: "already recorded" });
    expect(mail.send).not.toHaveBeenCalled();
  });

  test("a credit pack is a purchase too, so it gets a receipt", async () => {
    const db = fakeDb();
    const mail = fakeMailer();
    const outcome = await recordPurchaseAndSendReceipt(
      {
        ...TRANSACTION,
        subscription_id: null,
        details: { totals: { grand_total: "900" } },
        items: [{ price: { description: "Style credits — 50 pack" } }],
      },
      { db, mail: mail as never, now: () => NOW },
    );

    expect(outcome.claimed).toBe(true);
    const pdf = Buffer.from(mail.send.mock.calls[0][0].attachments?.[0].content ?? []).toString(
      "latin1",
    );
    expect(pdf).toContain("Style credits");
    expect(pdf).toContain("$9.00");
  });

  test("keeps the ledger row and still emails when storage refuses the upload", async () => {
    const db = fakeDb({ uploadError: "bucket unavailable" });
    const mail = fakeMailer();
    const outcome = await recordPurchaseAndSendReceipt(TRANSACTION, {
      db,
      mail: mail as never,
      now: () => NOW,
    });

    expect(outcome).toMatchObject({ claimed: true, emailed: true, receiptPath: null });
  });

  test("reports a mail failure without losing the purchase", async () => {
    const db = fakeDb();
    const mail = fakeMailer({ sent: false, error: "resend 422" });
    const outcome = await recordPurchaseAndSendReceipt(TRANSACTION, {
      db,
      mail: mail as never,
      now: () => NOW,
    });

    expect(outcome).toMatchObject({ claimed: true, emailed: false, error: "resend 422" });
  });

  test("says so when the member has no email address", async () => {
    const db = fakeDb();
    const mail = fakeMailer();
    const outcome = await recordPurchaseAndSendReceipt(
      { ...TRANSACTION, custom_data: { user_id: "user-2" } },
      {
        db,
        mail: mail as never,
        now: () => NOW,
        loadMember: async () => ({ name: "Nadia Haddad", email: null }),
      },
    );

    expect(outcome).toMatchObject({
      claimed: true,
      emailed: false,
      error: "member has no email address",
    });
    expect(mail.send).not.toHaveBeenCalled();
  });

  test("ignores a payment that is not completed", async () => {
    const db = fakeDb();
    const mail = fakeMailer();
    const outcome = await recordPurchaseAndSendReceipt(
      { ...TRANSACTION, status: "past_due" },
      { db, mail: mail as never, now: () => NOW },
    );

    expect(outcome).toMatchObject({ claimed: false, skipped: "not a completed payment" });
    expect(mail.send).not.toHaveBeenCalled();
  });
});
