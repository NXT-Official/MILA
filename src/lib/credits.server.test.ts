import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  consumeAiCredit,
  createCreditAvailabilityCache,
  createTrackedCreditStore,
  grantAiCredits,
  isPaidStyleMember,
  payForLookImage,
  toTrackedCreditsError,
  TrackedCreditsUnavailableError,
  withAiCredit,
  type TrackedCreditStore,
} from "./credits.server";
import { InsufficientCreditsError } from "./credits";
import { MemoryCreditStore } from "../../tests/helpers/memory-credit-store";

function fakeSupabase(
  plan: { plan_id: string } | null,
  credits_included: number | null,
  subscriptionOverrides: Partial<{
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  }> = {},
) {
  const subscription = plan
    ? {
        status: "active",
        current_period_end: "2999-01-01T00:00:00Z",
        cancel_at_period_end: false,
        ...plan,
        ...subscriptionOverrides,
      }
    : null;
  const chain = {
    select: (..._args: unknown[]) => chain,
    eq: (..._args: unknown[]) => chain,
    in: (..._args: unknown[]) => chain,
    order: (..._args: unknown[]) => chain,
    limit: (..._args: unknown[]) => chain,
    maybeSingle: async () => ({
      data: chain.table === "subscriptions" ? subscription : { credits_included },
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

  test("a cancelled subscription past its period end stops granting the allowance", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 100, {
      cancel_at_period_end: true,
      current_period_end: "2020-01-01T00:00:00Z",
    });
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

// CREDIT-REFUND-BUCKET: with the tracked pair (migration 20261007170000) a
// refund goes back to the bucket the credit came from. The legacy
// consume/grant stores are passed too, so each test below would fail if the
// tracked pair were ignored and the legacy refund path ran instead.
describe("withAiCredit with tracked credits", () => {
  const fail = async (): Promise<string> => {
    throw new Error("AI analysis failed.");
  };

  test("a refunded allowance credit goes back to the allowance; purchased credits untouched", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 2, "2026-07-24", 5);

    await expect(
      withAiCredit(supabase, "user-1", fail, {
        tracked: store.tracked,
        consume: store.consume,
        grant: store.grant,
      }),
    ).rejects.toThrow("AI analysis failed.");

    expect(store.balance("user-1")).toEqual({ daily: 2, purchased: 5, resetAt: "2026-07-24" });
  });

  test("refundIf: a purchased credit goes back to purchased", async () => {
    const supabase = fakeSupabase(null, null);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 0, "2026-07-24", 2);

    const result = await withAiCredit(supabase, "user-1", async () => ({ found: 0 }), {
      refundIf: (r) => r.found === 0,
      tracked: store.tracked,
      consume: store.consume,
      grant: store.grant,
    });

    expect(result).toEqual({ found: 0 });
    expect(store.balance("user-1")).toEqual({ daily: 0, purchased: 2, resetAt: "2026-07-24" });
  });

  test("an allowance credit refunded after midnight is owed, never purchased, and a fresh day's full pool absorbs it", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    let today = "2026-07-24";
    const store = new MemoryCreditStore(() => today);
    store.seed("user-1", 1, today, 0);

    await expect(
      withAiCredit(
        supabase,
        "user-1",
        async () => {
          today = "2026-07-25"; // the request outlives midnight
          throw new Error("AI analysis failed.");
        },
        { tracked: store.tracked, consume: store.consume, grant: store.grant },
      ),
    ).rejects.toThrow("AI analysis failed.");

    expect(store.balance("user-1")).toEqual({ daily: 0, purchased: 0, resetAt: "2026-07-24" });
    expect(store.owed("user-1")).toBe(1);

    // Her next request stamps the new day (allowance 3): 3 - 1. The owed
    // credit is settled against a full pool, so nothing is added: the pool is
    // capped at the day's allowance (ruling, CREDIT fix round 1).
    await withAiCredit(supabase, "user-1", async () => "reply", {
      tracked: store.tracked,
      consume: store.consume,
      grant: store.grant,
    });
    expect(store.balance("user-1")).toEqual({ daily: 2, purchased: 0, resetAt: "2026-07-25" });
    expect(store.owed("user-1")).toBe(0);
  });

  test("a rolled-over refund refills a pool she already used today, up to the allowance, before purchased", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 1);
    let today = "2026-07-24";
    const store = new MemoryCreditStore(() => today);
    store.seed("user-1", 1, today, 1);
    const opts = { tracked: store.tracked, consume: store.consume, grant: store.grant };

    await expect(
      withAiCredit(
        supabase,
        "user-1",
        async () => {
          today = "2026-07-25";
          throw new Error("AI analysis failed.");
        },
        opts,
      ),
    ).rejects.toThrow("AI analysis failed.");
    store.seed("user-1", 0, "2026-07-25", 1); // today's 1 credit already used

    expect(await withAiCredit(supabase, "user-1", async () => "reply", opts)).toBe("reply");
    // The owed credit refilled the pool to 1 and paid; the purchased one is kept.
    expect(store.balance("user-1")).toEqual({ daily: 0, purchased: 1, resetAt: "2026-07-25" });
    expect(store.owed("user-1")).toBe(0);
  });

  test("refunds across the daily reset, night after night, never lift the pool above the allowance", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    let day = 24;
    const store = new MemoryCreditStore(() => `2026-07-${day}`);
    store.seed("user-1", 3, "2026-07-24", 0);
    const opts = {
      refundIf: (r: string) => r === "nothing found",
      tracked: store.tracked,
      consume: store.consume,
      grant: store.grant,
    };

    for (let night = 1; night <= 4; night += 1) {
      // Her whole pool is spent before midnight...
      const pool = store.balance("user-1")!.daily;
      const receipts = [];
      for (let i = 0; i < pool; i += 1) {
        receipts.push((await store.tracked.spend("user-1", 3)).receipt!.id);
      }
      day += 1; // ...midnight passes...
      for (const id of receipts) await store.tracked.refund(id); // ...and they are refunded after it.

      // Her first request of the new day, refunded the same day.
      await withAiCredit(supabase, "user-1", async () => "nothing found", opts);
      expect(store.balance("user-1")!.daily).toBeLessThanOrEqual(3);
      expect(store.balance("user-1")!.purchased).toBe(0);
    }
  });

  test("repeated same-day refunds return every allowance credit to the allowance; purchased unchanged", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 3, "2026-07-24", 0);

    for (let i = 0; i < 5; i += 1) {
      await withAiCredit(supabase, "user-1", async () => [], {
        refundIf: (items) => items.length === 0,
        tracked: store.tracked,
        consume: store.consume,
        grant: store.grant,
      });
    }

    expect(store.balance("user-1")).toEqual({ daily: 3, purchased: 0, resetAt: "2026-07-24" });
  });

  test("a successful request is charged once and not refunded", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 2, "2026-07-24", 1);

    expect(
      await withAiCredit(supabase, "user-1", async () => "reply", { tracked: store.tracked }),
    ).toBe("reply");
    expect(store.balance("user-1")).toEqual({ daily: 1, purchased: 1, resetAt: "2026-07-24" });
    expect(store.receiptCount("user-1")).toBe(1);
  });

  test("a depleted member never reaches the work and nothing is recorded", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 0, "2026-07-24", 0);
    let ran = false;

    await expect(
      withAiCredit(
        supabase,
        "user-1",
        async () => {
          ran = true;
          return "reply";
        },
        { tracked: store.tracked },
      ),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(ran).toBe(false);
    expect(store.receiptCount("user-1")).toBe(0);
  });

  test("migration not applied: today's consume/grant path runs unchanged, and the miss is remembered", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 2, "2026-07-24", 0);
    let spendCalls = 0;
    const missing: TrackedCreditStore = {
      spend: async () => {
        spendCalls += 1;
        throw new TrackedCreditsUnavailableError("spend_ai_credit_tracked: PGRST202");
      },
      refund: async () => {
        throw new Error("never called");
      },
    };
    const availability = createCreditAvailabilityCache();
    const opts = { tracked: missing, availability, consume: store.consume, grant: store.grant };

    await expect(withAiCredit(supabase, "user-1", fail, opts)).rejects.toThrow(
      "AI analysis failed.",
    );
    // Exactly today's behaviour: charged from the allowance, refunded by grant.
    expect(store.balance("user-1")).toEqual({ daily: 1, purchased: 1, resetAt: "2026-07-24" });

    expect(await withAiCredit(supabase, "user-1", async () => "reply", opts)).toBe("reply");
    expect(spendCalls).toBe(1);
  });

  test("falling back to the old path is reported (warn + error capture) once per miss window", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 3, "2026-07-24", 0);
    const reported: unknown[] = [];
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const missing: TrackedCreditStore = {
      spend: async () => {
        throw new TrackedCreditsUnavailableError("spend_ai_credit_tracked: 42883");
      },
      refund: async () => "refunded",
    };
    const opts = {
      tracked: missing,
      availability: createCreditAvailabilityCache(),
      consume: store.consume,
      grant: store.grant,
      report: (err: unknown) => reported.push(err),
    };

    try {
      await withAiCredit(supabase, "user-1", async () => "reply", opts);
      await withAiCredit(supabase, "user-1", async () => "reply", opts);
      expect(reported).toHaveLength(1);
      expect(reported[0]).toBeInstanceOf(TrackedCreditsUnavailableError);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("a tracked spend failing for any other reason is not retried on the old path", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 2, "2026-07-24", 0);
    const broken: TrackedCreditStore = {
      spend: async () => {
        throw new Error("connection reset");
      },
      refund: async () => "refunded",
    };

    await expect(
      withAiCredit(supabase, "user-1", async () => "reply", {
        tracked: broken,
        availability: createCreditAvailabilityCache(),
        consume: store.consume,
        grant: store.grant,
      }),
    ).rejects.toThrow("connection reset");
    expect(store.balance("user-1")).toEqual({ daily: 2, purchased: 0, resetAt: "2026-07-24" });
  });
});

// Dupe review M3: a refund that fails leaves the member charged, so it must
// reach error capture, not only the console.
describe("a failed refund is reported", () => {
  test("tracked path: the refund RPC failing is captured and logged; the produce error still surfaces", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 2, "2026-07-24", 0);
    const reported: unknown[] = [];
    const refundError = new Error("connection reset");
    const error = spyOn(console, "error").mockImplementation(() => {});
    const tracked: TrackedCreditStore = {
      spend: store.tracked.spend,
      refund: async () => {
        throw refundError;
      },
    };

    try {
      await expect(
        withAiCredit(supabase, "user-1", async () => [], {
          refundIf: (items) => items.length === 0,
          tracked,
          report: (err) => reported.push(err),
        }),
      ).resolves.toEqual([]);
      expect(reported).toContain(refundError);
      expect(error).toHaveBeenCalledWith("[withAiCredit] refund failed", refundError);
    } finally {
      error.mockRestore();
    }
  });

  test("old path: the grant failing is captured and logged", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 2, "2026-07-24", 0);
    const reported: unknown[] = [];
    const grantError = new Error("grant_ai_credits failed");
    const error = spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        withAiCredit(
          supabase,
          "user-1",
          async () => {
            throw new Error("AI analysis failed.");
          },
          {
            consume: store.consume,
            grant: async () => {
              throw grantError;
            },
            report: (err) => reported.push(err),
          },
        ),
      ).rejects.toThrow("AI analysis failed.");
      expect(reported).toContain(grantError);
      expect(error).toHaveBeenCalledWith("[withAiCredit] refund failed", grantError);
    } finally {
      error.mockRestore();
    }
  });

  test("payForLookImage: a failed refund of a paid render is captured", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 2, "2026-07-24", 0);
    const reported: unknown[] = [];
    const refundError = new Error("connection reset");
    const error = spyOn(console, "error").mockImplementation(() => {});

    try {
      await payForLookImage(supabase, "user-1", async () => ({ imageDataUri: null }), {
        claim: async () => false,
        mark: async () => {},
        tracked: {
          spend: store.tracked.spend,
          refund: async () => {
            throw refundError;
          },
        },
        report: (err) => reported.push(err),
      });
      expect(reported).toContain(refundError);
      expect(error).toHaveBeenCalledWith("[payForLookImage] refund failed", refundError);
    } finally {
      error.mockRestore();
    }
  });
});

describe("payForLookImage with tracked credits", () => {
  function trackedDeps(store: MemoryCreditStore, pending: boolean) {
    return {
      claim: async () => {
        const wasPending = pending;
        pending = false;
        return wasPending;
      },
      mark: async () => {
        pending = true;
      },
      tracked: store.tracked,
      consume: store.consume,
      grant: store.grant,
      isPending: () => pending,
    };
  }
  const noImage = async () => ({ imageDataUri: null });

  test("a paid render with no image refunds the allowance credit to the allowance", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 2, "2026-07-24", 4);

    await payForLookImage(supabase, "user-1", noImage, trackedDeps(store, false));
    expect(store.balance("user-1")).toEqual({ daily: 2, purchased: 4, resetAt: "2026-07-24" });
  });

  test("a paid render that throws refunds a purchased credit to purchased", async () => {
    const supabase = fakeSupabase(null, null);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 0, "2026-07-24", 1);

    await expect(
      payForLookImage(
        supabase,
        "user-1",
        async (): Promise<{ imageDataUri: string | null }> => {
          throw new Error("render failed");
        },
        trackedDeps(store, false),
      ),
    ).rejects.toThrow("render failed");
    expect(store.balance("user-1")).toEqual({ daily: 0, purchased: 1, resetAt: "2026-07-24" });
  });

  test("the free render re-arms its slot and never touches credits", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 2, "2026-07-24", 0);
    const deps = trackedDeps(store, true);

    await payForLookImage(supabase, "user-1", noImage, deps);
    expect(deps.isPending()).toBe(true);
    expect(store.receiptCount("user-1")).toBe(0);
    expect(store.balance("user-1")).toEqual({ daily: 2, purchased: 0, resetAt: "2026-07-24" });
  });

  test("migration not applied: today's path runs unchanged", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 3);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 2, "2026-07-24", 0);
    const deps = {
      ...trackedDeps(store, false),
      tracked: {
        spend: async () => {
          throw new TrackedCreditsUnavailableError("spend_ai_credit_tracked: 42883");
        },
        refund: async () => "refunded" as const,
      },
      availability: createCreditAvailabilityCache(),
    };

    await payForLookImage(supabase, "user-1", noImage, deps);
    expect(store.balance("user-1")).toEqual({ daily: 1, purchased: 1, resetAt: "2026-07-24" });
  });
});

describe("tracked credit availability", () => {
  test("PostgREST / Postgres 'function or table missing' codes mean the migration is not applied", () => {
    for (const code of ["PGRST202", "PGRST205", "42883", "42P01"]) {
      expect(toTrackedCreditsError("spend_ai_credit_tracked", { code })).toBeInstanceOf(
        TrackedCreditsUnavailableError,
      );
    }
    const other = toTrackedCreditsError("spend_ai_credit_tracked", {
      code: "P0001",
      message: "entitlements_not_found",
    });
    expect(other).not.toBeInstanceOf(TrackedCreditsUnavailableError);
    expect(other.message).toBe("entitlements_not_found");
  });

  test("the database store reads the RPC rows and keeps the client's this", async () => {
    const calls: string[] = [];
    const client = {
      tag: "client",
      rpc(this: { tag: string }, fn: string, args: Record<string, unknown>) {
        calls.push(`${this.tag}:${fn}:${JSON.stringify(args)}`);
        const answer =
          fn === "spend_ai_credit_tracked"
            ? {
                data: {
                  allowed: true,
                  remaining: 4,
                  receipt_id: "r-1",
                  bucket: "daily",
                  credit_day: "2026-07-24",
                },
                error: null,
              }
            : { data: "owed", error: null };
        return Object.assign(Promise.resolve(answer), { single: () => Promise.resolve(answer) });
      },
    };
    const store = createTrackedCreditStore(async () => client);

    expect(await store.spend("user-1", 3)).toEqual({
      allowed: true,
      remaining: 4,
      receipt: { id: "r-1", bucket: "daily", creditDay: "2026-07-24" },
    });
    expect(await store.refund("r-1")).toBe("owed");
    expect(calls).toEqual([
      'client:spend_ai_credit_tracked:{"p_user_id":"user-1","p_daily_allowance":3}',
      'client:refund_ai_credit_tracked:{"p_receipt_id":"r-1"}',
    ]);
  });

  test("the database store: a refused spend has no receipt; a missing function means unavailable", async () => {
    const refused = {
      data: { allowed: false, remaining: 0, receipt_id: null, bucket: null, credit_day: null },
      error: null,
    };
    const missing = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    };
    const clientFor = (answer: unknown) => ({
      rpc: () => Object.assign(Promise.resolve(answer), { single: () => Promise.resolve(answer) }),
    });

    expect(
      await createTrackedCreditStore(async () => clientFor(refused) as never).spend("u", 0),
    ).toEqual({
      allowed: false,
      remaining: 0,
      receipt: null,
    });
    await expect(
      createTrackedCreditStore(async () => clientFor(missing) as never).spend("u", 0),
    ).rejects.toBeInstanceOf(TrackedCreditsUnavailableError);
    await expect(
      createTrackedCreditStore(async () => clientFor(missing) as never).refund("r"),
    ).rejects.toBeInstanceOf(TrackedCreditsUnavailableError);
  });

  test("a remembered miss expires, so applying the migration needs no redeploy", () => {
    let now = 1_000;
    const cache = createCreditAvailabilityCache(60_000, () => now);
    expect(cache.isMissing()).toBe(false);
    cache.markMissing();
    expect(cache.isMissing()).toBe(true);
    now += 60_001;
    expect(cache.isMissing()).toBe(false);
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

describe("isPaidStyleMember", () => {
  function fakeMember(
    subscription: Record<string, unknown> | null,
    purchasedCredits: number | null,
  ) {
    let table = "";
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({
        data:
          table === "subscriptions"
            ? subscription
            : purchasedCredits == null
              ? null
              : { purchased_credits: purchasedCredits },
        error: null,
      }),
    };
    return {
      from: (t: string) => {
        table = t;
        return chain;
      },
    } as unknown as Parameters<typeof isPaidStyleMember>[0];
  }
  const live = {
    plan_id: "plan-1",
    status: "active",
    current_period_end: "2999-01-01T00:00:00Z",
    cancel_at_period_end: false,
  };

  test("a live subscriber is paid even with no purchased credits", async () => {
    expect(await isPaidStyleMember(fakeMember(live, 0), "u")).toBe(true);
  });

  test("purchased style credits make a non-subscriber paid", async () => {
    expect(await isPaidStyleMember(fakeMember(null, 3), "u")).toBe(true);
  });

  test("no subscription and no purchased credits is a free member", async () => {
    expect(await isPaidStyleMember(fakeMember(null, 0), "u")).toBe(false);
    expect(await isPaidStyleMember(fakeMember(null, null), "u")).toBe(false);
  });

  test("a subscription past its paid period does not count", async () => {
    const lapsed = {
      ...live,
      cancel_at_period_end: true,
      current_period_end: "2000-01-01T00:00:00Z",
    };
    expect(await isPaidStyleMember(fakeMember(lapsed, 0), "u")).toBe(false);
  });
});
