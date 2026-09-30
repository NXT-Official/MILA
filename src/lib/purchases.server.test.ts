import { describe, expect, mock, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  claimPurchase,
  isRecordableTransaction,
  purchaseMetadata,
  setPurchaseReceiptPath,
  transactionAmountCents,
  transactionTaxCents,
  type CompletedTransaction,
} from "./purchases.server";

type Row = Record<string, unknown>;

type FakeConfig = {
  existingPurchase?: { id: string; metadata?: Row } | null;
  profile?: Row | null;
  email?: string | null;
  subscription?: Row | null;
  plan?: Row | null;
  insertError?: string | null;
  readError?: string | null;
  bucketError?: string | null;
  uploadError?: string | null;
};

function fakeDb(config: FakeConfig = {}) {
  const inserted: Row[] = [];
  const updated: Row[] = [];
  const uploads: { path: string; bytes: Uint8Array }[] = [];
  const bucketCalls = { count: 0 };

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
        if (mode === "insert") {
          return config.insertError
            ? { data: null, error: { message: config.insertError } }
            : { data: { id: "purchase-1" }, error: null };
        }
        if (mode === "update") return { data: null, error: null };
        if (config.readError) return { data: null, error: { message: config.readError } };
        if (table === "purchases") return { data: config.existingPurchase ?? null, error: null };
        if (table === "profiles") return { data: config.profile ?? null, error: null };
        if (table === "subscriptions") return { data: config.subscription ?? null, error: null };
        if (table === "subscription_plans") return { data: config.plan ?? null, error: null };
        return { data: null, error: null };
      },
    };
    return chain;
  }

  const db = {
    from: (table: string) => tableChain(table),
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user:
              config.email === undefined
                ? { email: "member@example.com" }
                : { email: config.email },
          },
          error: null,
        }),
      },
    },
    storage: {
      createBucket: async () => {
        bucketCalls.count += 1;
        return config.bucketError
          ? { data: null, error: { message: config.bucketError } }
          : { data: {}, error: null };
      },
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          uploads.push({ path, bytes });
          return config.uploadError
            ? { data: null, error: { message: config.uploadError } }
            : { data: { path }, error: null };
        },
      }),
    },
  } as unknown as SupabaseClient<Database>;

  return { db, inserted, updated, uploads, bucketCalls };
}

const TRANSACTION: CompletedTransaction = {
  id: "txn_01kztk3s79phsrq1e8b76w8a0e",
  status: "completed",
  subscription_id: "sub_01kztk3s79phsrq1e8b76w8a0e",
  customer_id: "ctm_01kztk3s79phsrq1e8b76w8a0e",
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

describe("transaction amounts", () => {
  test("reads Paddle's minor-unit totals", () => {
    expect(transactionAmountCents(TRANSACTION)).toBe(4999);
    expect(transactionTaxCents(TRANSACTION)).toBe(500);
  });

  test("falls back to total when grand_total is absent", () => {
    expect(
      transactionAmountCents({
        ...TRANSACTION,
        details: { totals: { total: "1200" } },
      }),
    ).toBe(1200);
  });

  test("returns null rather than guessing at a missing or malformed total", () => {
    expect(transactionAmountCents({ ...TRANSACTION, details: null })).toBeNull();
    expect(
      transactionAmountCents({ ...TRANSACTION, details: { totals: { grand_total: "4.99" } } }),
    ).toBeNull();
    expect(transactionTaxCents({ ...TRANSACTION, details: null })).toBeNull();
  });
});

describe("isRecordableTransaction", () => {
  test("accepts a completed payment that names its member", () => {
    expect(isRecordableTransaction(TRANSACTION)).toBe(true);
  });

  test("refuses anything that is not money in the bank", () => {
    expect(isRecordableTransaction({ ...TRANSACTION, status: "draft" })).toBe(false);
    expect(isRecordableTransaction({ ...TRANSACTION, status: "past_due" })).toBe(false);
    expect(isRecordableTransaction({ ...TRANSACTION, custom_data: null })).toBe(false);
    expect(isRecordableTransaction({ ...TRANSACTION, details: null })).toBe(false);
  });
});

describe("purchaseMetadata", () => {
  test("carries the ids the admin console links on", () => {
    expect(purchaseMetadata(TRANSACTION)).toEqual({
      paddle_transaction_id: "txn_01kztk3s79phsrq1e8b76w8a0e",
      paddle_subscription_id: "sub_01kztk3s79phsrq1e8b76w8a0e",
      paddle_customer_id: "ctm_01kztk3s79phsrq1e8b76w8a0e",
      invoice_number: "MILA-0001234",
      billed_at: "2026-09-30T09:15:00.000Z",
      receipt_path: null,
    });
  });

  test("falls back to created_at when Paddle omits billed_at", () => {
    const metadata = purchaseMetadata({ ...TRANSACTION, billed_at: null });
    expect(metadata.billed_at).toBe("2026-09-30T09:15:00.000Z");
  });
});

describe("claimPurchase", () => {
  test("writes one ledger row per Paddle transaction", async () => {
    const { db, inserted } = fakeDb();
    const result = await claimPurchase(db, TRANSACTION);

    expect(result).toEqual({ recorded: true, purchaseId: "purchase-1", userId: "user-1" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      table: "purchases",
      user_id: "user-1",
      product_id: "pro_1",
      amount_cents: 4999,
      currency: "USD",
      status: "completed",
    });
    expect((inserted[0].metadata as Row).invoice_number).toBe("MILA-0001234");
  });

  test("does not write a second row for a transaction already in the ledger", async () => {
    const { db, inserted } = fakeDb({ existingPurchase: { id: "purchase-9" } });
    const result = await claimPurchase(db, TRANSACTION);

    expect(result).toEqual({ recorded: false, purchaseId: "purchase-9", userId: "user-1" });
    expect(inserted).toHaveLength(0);
  });

  test("records nothing for a payment that is not completed", async () => {
    const { db, inserted } = fakeDb();
    const result = await claimPurchase(db, { ...TRANSACTION, status: "canceled" });

    expect(result.recorded).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  test("surfaces a ledger failure instead of silently dropping the payment", async () => {
    const { db } = fakeDb({ insertError: "permission denied" });
    await expect(claimPurchase(db, TRANSACTION)).rejects.toThrow(/permission denied/);
  });
});

describe("setPurchaseReceiptPath", () => {
  test("stores the storage path on the existing ledger row", async () => {
    const { db, updated } = fakeDb({
      existingPurchase: { id: "purchase-1", metadata: { invoice_number: "MILA-0001234" } },
    });
    await setPurchaseReceiptPath(db, TRANSACTION.id, "user-1/txn.pdf");

    expect(updated).toHaveLength(1);
    expect(updated[0].metadata).toEqual({
      invoice_number: "MILA-0001234",
      receipt_path: "user-1/txn.pdf",
    });
  });

  test("does nothing when the purchase is not in the ledger", async () => {
    const { db, updated } = fakeDb({ existingPurchase: null });
    await setPurchaseReceiptPath(db, TRANSACTION.id, "user-1/txn.pdf");
    expect(updated).toHaveLength(0);
  });
});
