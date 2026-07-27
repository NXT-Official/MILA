import { describe, expect, mock, test } from "bun:test";
import { consumeAiCredit, grantAiCredits, payForLookImage } from "./credits.server";
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

  test("falls back to DEFAULT_AI_CREDITS with no in-force subscription", async () => {
    const supabase = fakeSupabase(null, null);
    const store = new MemoryCreditStore(() => "2026-07-24");
    const remaining = await consumeAiCredit(supabase, "user-1", store.consume);
    expect(remaining).toBe(4);
  });

  test("throws InsufficientCreditsError at zero and does not go negative", async () => {
    const supabase = fakeSupabase({ plan_id: "plan-1" }, 1);
    const store = new MemoryCreditStore(() => "2026-07-24");
    store.seed("user-1", 0, "2026-07-24");
    await expect(consumeAiCredit(supabase, "user-1", store.consume)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
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
    expect(remaining).toBe(15); // DEFAULT_AI_CREDITS (5) + 10
  });
});
