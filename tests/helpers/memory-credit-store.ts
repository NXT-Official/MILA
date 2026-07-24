import type { ConsumeCreditStore } from "../../src/lib/credits.server";

export class MemoryCreditStore {
  private entitlements = new Map<string, { credits: number; resetAt: string }>();

  constructor(private today: () => string) {}

  seed(userId: string, credits: number, resetAt: string) {
    this.entitlements.set(userId, { credits, resetAt });
  }

  consume: ConsumeCreditStore = async (userId, dailyAllowance) => {
    const today = this.today();
    const existing = this.entitlements.get(userId) ?? { credits: dailyAllowance, resetAt: "" };
    const credits = existing.resetAt === today ? existing.credits : dailyAllowance;
    if (credits <= 0) {
      this.entitlements.set(userId, { credits: 0, resetAt: today });
      return { allowed: false, remaining: 0 };
    }
    const remaining = credits - 1;
    this.entitlements.set(userId, { credits: remaining, resetAt: today });
    return { allowed: true, remaining };
  };
}
