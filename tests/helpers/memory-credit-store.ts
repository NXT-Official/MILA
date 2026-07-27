import type { ConsumeCreditStore, GrantCreditStore } from "../../src/lib/credits.server";

/**
 * Mirrors consume_ai_credit / grant_ai_credits: a resettable daily allowance
 * plus a purchased balance the daily reset never touches.
 */
export class MemoryCreditStore {
  private entitlements = new Map<string, { daily: number; purchased: number; resetAt: string }>();

  constructor(private today: () => string) {}

  seed(userId: string, credits: number, resetAt: string, purchased = 0) {
    this.entitlements.set(userId, { daily: credits, purchased, resetAt });
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
}
