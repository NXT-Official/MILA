import type {
  ConsumeCreditStore,
  GrantCreditStore,
  TrackedCreditStore,
  TrackedRefundOutcome,
} from "../../src/lib/credits.server";

type Receipt = {
  id: string;
  userId: string;
  bucket: "daily" | "purchased";
  creditDay: string;
  refunded: boolean;
  applied: boolean;
};

/**
 * Mirrors consume_ai_credit / grant_ai_credits: a resettable daily allowance
 * plus a purchased balance the daily reset never touches. `tracked` mirrors
 * spend_ai_credit_tracked / refund_ai_credit_tracked (migration
 * 20261007170000): a refund goes back to the bucket the credit came from. A
 * daily credit refunded the same day goes back in full; one whose day rolled
 * over is owed and settled by the next spend, capped at that day's allowance
 * (pool = min(allowance, current + owed)). Never a purchased credit.
 */
export class MemoryCreditStore {
  private entitlements = new Map<string, { daily: number; purchased: number; resetAt: string }>();
  private receipts = new Map<string, Receipt>();
  private nextReceipt = 1;

  constructor(private today: () => string) {}

  seed(userId: string, credits: number, resetAt: string, purchased = 0) {
    this.entitlements.set(userId, { daily: credits, purchased, resetAt });
  }

  /** The stored balance (no day reset applied), for assertions. */
  balance(userId: string) {
    const existing = this.entitlements.get(userId);
    return existing ? { ...existing } : undefined;
  }

  /** Refunded daily credits still waiting for today's pool. */
  owed(userId: string): number {
    return [...this.receipts.values()].filter(
      (r) => r.userId === userId && r.bucket === "daily" && r.refunded && !r.applied,
    ).length;
  }

  /** Tracked spends recorded so far (refused spends record nothing). */
  receiptCount(userId: string): number {
    return [...this.receipts.values()].filter((r) => r.userId === userId).length;
  }

  /** Applies the day-reset to the allowance; purchased credits pass through. */
  private read(userId: string, dailyAllowance: number) {
    const today = this.today();
    const existing = this.entitlements.get(userId) ?? {
      daily: dailyAllowance,
      purchased: 0,
      resetAt: "",
    };
    return {
      today,
      daily: existing.resetAt === today ? existing.daily : dailyAllowance,
      purchased: existing.purchased,
    };
  }

  consume: ConsumeCreditStore = async (userId, dailyAllowance) => {
    const { today } = this.read(userId, dailyAllowance);
    let { daily, purchased } = this.read(userId, dailyAllowance);

    // Allowance first — it expires at midnight, purchased credits don't.
    if (daily > 0) daily -= 1;
    else if (purchased > 0) purchased -= 1;
    else {
      this.entitlements.set(userId, { daily, purchased, resetAt: today });
      return { allowed: false, remaining: 0 };
    }

    this.entitlements.set(userId, { daily, purchased, resetAt: today });
    return { allowed: true, remaining: daily + purchased };
  };

  grant: GrantCreditStore = async (userId, dailyAllowance, amount) => {
    const { today, daily, purchased } = this.read(userId, dailyAllowance);
    const total = purchased + amount;
    this.entitlements.set(userId, { daily, purchased: total, resetAt: today });
    return daily + total;
  };

  /**
   * Mirrors land_owed_daily_refunds: only into a pool stamped today. With no
   * cap (the refund path), same-day refunds land in full. With a cap (a
   * spend), every owed refund is settled and lands up to the cap:
   * pool = min(cap, current + owed); the rest is absorbed.
   */
  private landOwed(userId: string, poolCap?: number): number {
    const existing = this.entitlements.get(userId);
    if (!existing || existing.resetAt !== this.today()) return 0;
    let owed = 0;
    for (const receipt of this.receipts.values()) {
      if (receipt.userId !== userId || receipt.bucket !== "daily") continue;
      if (!receipt.refunded || receipt.applied) continue;
      if (poolCap === undefined && receipt.creditDay !== this.today()) continue;
      receipt.applied = true;
      owed += 1;
    }
    const landed =
      poolCap === undefined ? owed : Math.min(owed, Math.max(poolCap - existing.daily, 0));
    existing.daily += landed;
    return landed;
  }

  tracked: TrackedCreditStore = {
    spend: async (userId, dailyAllowance) => {
      const purchasedBefore = this.entitlements.get(userId)?.purchased ?? 0;
      this.landOwed(userId, dailyAllowance);
      let { allowed } = await this.consume(userId, dailyAllowance);
      const purchasedMid = this.entitlements.get(userId)?.purchased ?? 0;
      const spentDaily = allowed && purchasedMid === purchasedBefore ? 1 : 0;
      let landed = this.landOwed(userId, dailyAllowance - spentDaily);
      if (!allowed && landed > 0) {
        ({ allowed } = await this.consume(userId, dailyAllowance));
        landed = 0;
      }
      if (!allowed) return { allowed: false, remaining: 0, receipt: null };

      const balance = this.entitlements.get(userId)!;
      if (balance.purchased < purchasedBefore && landed > 0) {
        balance.daily -= 1;
        balance.purchased += 1;
      }
      const bucket = balance.purchased < purchasedBefore ? "purchased" : "daily";
      const receipt: Receipt = {
        id: `receipt-${this.nextReceipt++}`,
        userId,
        bucket,
        creditDay: this.today(),
        refunded: false,
        applied: false,
      };
      this.receipts.set(receipt.id, receipt);
      return {
        allowed: true,
        remaining: balance.daily + balance.purchased,
        receipt: { id: receipt.id, bucket, creditDay: receipt.creditDay },
      };
    },

    refund: async (receiptId): Promise<TrackedRefundOutcome> => {
      const receipt = this.receipts.get(receiptId);
      if (!receipt) throw new Error("credit_receipt_not_found");
      if (receipt.refunded) return "already_refunded";
      receipt.refunded = true;
      if (receipt.bucket === "purchased") {
        receipt.applied = true;
        const balance = this.entitlements.get(receipt.userId);
        if (balance) balance.purchased += 1;
        return "refunded";
      }
      this.landOwed(receipt.userId);
      return receipt.applied ? "refunded" : "owed";
    },
  };
}
