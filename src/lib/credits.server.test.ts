import { describe, expect, mock, test } from "bun:test";
import { consumeAiCredit, grantAiCredits, payForLookImage, withAiCredit } from "./credits.server";
import { InsufficientCreditsError } from "./credits";
import { MemoryCreditStore } from "../../tests/helpers/memory-credit-store";

function fakeSupabase(plan: { plan_id: string } | null, credits_included: number | null) {
  const chain = {
    select: (..._args: unknown[]) => chain,
    eq: (..._args: unknown[]) => chain,
    in: (..._args: unknown[]) => chain,
    order: (..._args: unknown[]) => chain,
    limit: (..._args: unknown[]) => chain,
    maybeSingle: async () => ({
      data: chain.table === "subscriptions" ? plan : { credits_included },
      error: null,
    }),
    table: "",
  };
  return {
    from: mock((table: string) => {
      chain.table = table;
      return chain;
    }),
  } as unknown as Parameters<typeof consumeAiCredit>[0];
}

describe("consumeAiCredit", () => {
  test("uses the in-force subscription's daily allowance", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 100);
    const store = new MemoryCreditStore(() => "2026-07-24");
    const remaining = await consumeAiCredit(supabase, "user-1", store.consume);
    expect(remaining).toBe(99);
  });

  test("a user with no in-force subscription has nothing to spend", async () => {
    const supabase = fakeSupabase(null, null);
    const store = new MemoryCreditStore(() => "2026-07-24");
    await expect(consumeAiCredit(supabase, "user-1", store.consume)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
  });

  test("throws InsufficientCreditsError at zero and does not go negative", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 1);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 0, "2026-07-24");
    await expect(consumeAiCredit(supabase, "user-1", store.consume)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
  });

  test("purchased credits survive the daily reset", async () => {
    const supabase = fakeSupabase(null, null); // free tier: 0 allowance
    let today = "2026-07-24";
    const store = new MemoryCreditStore(() => today);
    store.seed("user-1", 0, today, 3); // bought a 3-credit pack

    expect(await consumeAiCredit(supabase, "user-1", store.consume)).toBe(2);
    today = "2026-07-25";
    expect(await consumeAiCredit(supabase, "user-1", store.consume)).toBe(1);
    expect(await consumeAiCredit(supabase, "user-1", store.consume)).toBe(0);
    await expect(consumeAiCredit(supabase, "user-1", store.consume)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
  });

  test("spends the expiring allowance before purchased credits", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 2);
    let today = "2026-07-24";
    const store = new MemoryCreditStore(() => today);
    store.seed("user-1", 2, today, 5);

    await consumeAiCredit(supabase, "user-1", store.consume);
    await consumeAiCredit(supabase, "user-1", store.consume);
    // Allowance gone, pack untouched — tomorrow's reset restores 2 on top of 5.
    today = "2026-07-25";
    expect(await consumeAiCredit(supabase, "user-1", store.consume)).toBe(6);
  });

  test("resets to the daily allowance on a new day", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 100);
    let today = "2026-07-24";
    const store = new MemoryCreditStore(() => today);
    store.seed("user-1", 0, "2026-07-24");
    await expect(consumeAiCredit(supabase, "user-1", store.consume)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    today = "2026-07-25";
    const remaining = await consumeAiCredit(supabase, "user-1", store.consume);
    expect(remaining).toBe(99);
  });
});

describe("withAiCredit", () => {
  test("charges once when the work succeeds", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 10);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 10, "2026-07-24");

    const result = await withAiCredit(supabase, "user-1", async () => "reply", {
      consume: store.consume,
      grant: store.grant,
    });

    expect(result).toBe("reply");
    // 10 - 1 charged, then this assertion spends one more.
    expect(await store.consume("user-1", 10)).toEqual({ allowed: true, remaining: 8 });
  });

  test("refunds when the work throws", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 10);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 10, "2026-07-24");

    await expect(
      withAiCredit(
        supabase,
        "user-1",
        async () => {
          throw new Error("AI analysis failed.");
        },
        { consume: store.consume, grant: store.grant },
      ),
    ).rejects.toThrow("AI analysis failed.");

    // Charged then refunded: the assertion below is the only credit spent.
    expect(await store.consume("user-1", 10)).toEqual({ allowed: true, remaining: 9 });
  });

  test("refunds when the work reports failure by returning", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 10);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 10, "2026-07-24");

    const result = await withAiCredit(
      supabase,
      "user-1",
      async () => ({ success: false as const, error: "ANALYSIS_PARSING_FAILED" }),
      { refundIf: (r) => !r.success, consume: store.consume, grant: store.grant },
    );

    expect(result.success).toBe(false);
    // Charged then refunded: the assertion below is the only credit spent.
    expect(await store.consume("user-1", 10)).toEqual({ allowed: true, remaining: 9 });
  });

  test("a depleted user never reaches the work", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 10);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 0, "2026-07-24");
    let ran = false;

    await expect(
      withAiCredit(
        supabase,
        "user-1",
        async () => {
          ran = true;
          return "reply";
        },
        { consume: store.consume, grant: store.grant },
      ),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(ran).toBe(false);
  });
});

describe("payForLookImage", () => {
  function lookImageDeps(store: MemoryCreditStore, pending: boolean) {
    return {
      claim: async () => {
        const wasPending = pending;
        pending = false;
        return wasPending;
      },
      mark: async () => {
        pending = true;
      },
      consume: store.consume,
      grant: store.grant,
      isPending: () => pending,
    };
  }
  const image = async () => ({ imageDataUri: "data:image/png;base64,x" });
  const noImage = async () => ({ imageDataUri: null });

  test("the look's first visual is free, every render after it costs a credit", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 10);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 10, "2026-07-24");
    const deps = lookImageDeps(store, true);

    await payForLookImage(supabase, "user-1", image, deps);
    expect(await store.consume("user-1", 10)).toEqual({ allowed: true, remaining: 9 });

    await payForLookImage(supabase, "user-1", image, deps);
    await payForLookImage(supabase, "user-1", image, deps);
    expect(await store.consume("user-1", 10)).toEqual({ allowed: true, remaining: 6 });
  });

  test("a render that produces no image costs nothing", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 10);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 10, "2026-07-24");
    const deps = lookImageDeps(store, true);

    // Free render fails → the entitlement is re-armed, so retrying is still free.
    await payForLookImage(supabase, "user-1", noImage, deps);
    expect(deps.isPending()).toBe(true);

    // Paid render fails → the credit comes back.
    await payForLookImage(supabase, "user-1", image, deps); // spends the free one
    await payForLookImage(supabase, "user-1", noImage, deps);
    expect(await store.consume("user-1", 10)).toEqual({ allowed: true, remaining: 9 });
  });

  test("a depleted user is refused a paid render", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 10);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 0, "2026-07-24");
    await expect(
      payForLookImage(supabase, "user-1", image, lookImageDeps(store, false)),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
  });
});

describe("grantAiCredits", () => {
  test("adds credits on top of today's existing balance", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 100);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 3, "2026-07-24");
    const remaining = await grantAiCredits(supabase, "user-1", 10, store.grant);
    expect(remaining).toBe(13);
  });

  test("resets to the daily allowance before granting when the balance is stale", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 100);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 0, "2026-07-23");
    const remaining = await grantAiCredits(supabase, "user-1", 10, store.grant);
    expect(remaining).toBe(110);
  });

  test("falls back to DEFAULT_AI_CREDITS with no in-force subscription", async () => {
    const supabase = fakeSupabase(null, null);
    const store = new MemoryCreditStore(() => "2026-07-24");
    const remaining = await grantAiCredits(supabase, "user-1", 10, store.grant);
    expect(remaining).toBe(10); // free tier grants nothing of its own
  });
});
