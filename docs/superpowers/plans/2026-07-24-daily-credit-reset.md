# Daily Credit Reset + Usage Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on real AI-credit enforcement with a daily-reset allowance (currently entirely stubbed), and replace the membership drawer's dead "in development" passes block with a real usage meter.

**Architecture:** A Postgres function (`consume_ai_credit`) does an atomic lazy reset-then-decrement, mirroring the existing `check_rate_limit` function's conventions exactly. `consumeAiCredit`/`isInsufficientCreditsError` (currently stubs) become real, using the same store-injection test pattern already established for `consumeRateLimit`. The UI wiring (paywall dialogs, credit display) was already built expecting this — only the underlying logic and one new meter component are new.

**Tech Stack:** Postgres/plpgsql (Supabase), TanStack Start, `bun:test`, React.

## Global Constraints

- Enforcement, not just tracking: generation blocks at 0 credits via the already-wired `InsufficientCreditsError` → `UpgradeSlotsDialog` paths (spec: "Decisions").
- Reset is lazy (checked on every `consume_ai_credit` call), no cron — this project has no scheduled-job infrastructure (spec: "Decisions").
- Reset boundary is UTC midnight, uniformly, for every plan including the free tier (spec: "Decisions").
- Atelier Elite's daily allowance is 150 (not 1500 — spec: "Decisions").
- No new npm dependencies.
- Match existing conventions exactly: the `consume_ai_credit` SQL function mirrors `check_rate_limit` (`SECURITY DEFINER`, `SET search_path = pg_catalog, public`, `service_role`-only grant); `consumeAiCredit` mirrors `consumeRateLimit`'s injectable-store pattern, tested against an in-memory fake store (`MemoryRateLimitStore` precedent), not a mocked Supabase chain.

---

### Task 1: `credits_reset_at` column + `consume_ai_credit` function

**Files:**
- Create: `supabase/migrations/<timestamp>_add_credit_reset.sql`

**Interfaces:**
- Produces: `public.user_entitlements.credits_reset_at DATE`; Postgres function `consume_ai_credit(_user_id UUID, _daily_allowance INTEGER) RETURNS TABLE(allowed BOOLEAN, remaining INTEGER)`, callable only by `service_role` — used by Task 3.

- [ ] **Step 1: Confirm migration history is in sync**

Run:
```bash
npx --yes supabase migration list
```
Expected: every local migration shows a matching `remote` value (no drift — the last three
sub-projects left this in sync; if any row shows an empty `remote`, stop and report it
rather than guessing).

- [ ] **Step 2: Create the migration file via the CLI**

Run:
```bash
npx --yes supabase migration new add_credit_reset
```
Expected: creates `supabase/migrations/<timestamp>_add_credit_reset.sql`. Note the exact
filename it prints.

- [ ] **Step 3: Write the migration**

Replace the contents of `<migration_file>` with:

```sql
-- ============================================================================
-- Daily AI-credit reset.
--
-- user_entitlements.ai_credits previously only changed via the Paddle webhook
-- refilling it once per billing period (src/lib/paddle-webhook.server.ts).
-- That refill is now largely superseded by the daily lazy-reset below: the
-- next consume_ai_credit() call after any webhook-driven change will see
-- today's date doesn't match credits_reset_at (untouched by the webhook) and
-- overwrite ai_credits with the plan's daily allowance anyway. This is
-- harmless — no double-grant, no crash — just dead-but-correct overlap left
-- as-is rather than touching webhook logic again for this change.
--
-- credits_reset_at starts NULL for every existing row (no backfill needed):
-- NULL IS DISTINCT FROM CURRENT_DATE is true, so the first call for any user
-- naturally resets them to their plan's daily allowance.
-- ============================================================================

ALTER TABLE public.user_entitlements
  ADD COLUMN credits_reset_at DATE;

CREATE OR REPLACE FUNCTION public.consume_ai_credit(
  _user_id UUID,
  _daily_allowance INTEGER
)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _today DATE := CURRENT_DATE;
  _current_credits INTEGER;
  _current_reset_at DATE;
  _post_reset_credits INTEGER;
  _final_credits INTEGER;
BEGIN
  IF _daily_allowance IS NULL OR _daily_allowance < 0 THEN
    RAISE EXCEPTION 'invalid_daily_allowance';
  END IF;

  -- Row lock: concurrent calls for the same user serialize here, so two
  -- requests racing can never both observe pre-reset/pre-decrement credits.
  -- Same atomicity guarantee check_rate_limit gets from its single-statement
  -- upsert, achieved here via an explicit lock instead.
  SELECT ai_credits, credits_reset_at INTO _current_credits, _current_reset_at
  FROM public.user_entitlements
  WHERE user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'entitlements_not_found';
  END IF;

  _post_reset_credits := CASE
    WHEN _current_reset_at IS DISTINCT FROM _today THEN _daily_allowance
    ELSE _current_credits
  END;

  IF _post_reset_credits <= 0 THEN
    UPDATE public.user_entitlements
    SET ai_credits = 0, credits_reset_at = _today
    WHERE user_id = _user_id;
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  UPDATE public.user_entitlements
  SET ai_credits = _post_reset_credits - 1, credits_reset_at = _today
  WHERE user_id = _user_id
  RETURNING ai_credits INTO _final_credits;

  RETURN QUERY SELECT true, _final_credits;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_ai_credit(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_credit(UUID, INTEGER) TO service_role;
```

- [ ] **Step 4: Preview, then push**

Run:
```bash
npx --yes supabase db push --dry-run
```
Expected: `Would push these migrations:` listing only `<migration_file>`. If it lists
anything else, or the migration sorts before the latest already-applied one (check with
`npx --yes supabase migration list` — the new file's timestamp must be later than
`20260724130000`), rename the file to a later timestamp before continuing.

Run:
```bash
npx --yes supabase db push
```
Expected: `Applying migration <migration_file>...` then `Finished supabase db push.`

- [ ] **Step 5: Verify against the live database**

Run:
```bash
set -a && source .env && set +a && node -e '
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
db.from("user_entitlements").select("credits_reset_at").limit(1).then(({ error }) => {
  if (error) { console.error(error); process.exit(1); }
  console.log("credits_reset_at column OK");
});
db.rpc("consume_ai_credit", { _user_id: "00000000-0000-0000-0000-000000000000", _daily_allowance: 5 })
  .then(({ error }) => {
    // Expect the entitlements_not_found error for a nonexistent user — this
    // confirms the function exists and runs, not that this fake user exists.
    console.log(error?.message?.includes("entitlements_not_found") ? "function OK" : JSON.stringify(error));
  });
'
```
Expected: `credits_reset_at column OK` and `function OK`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add daily credit reset column and atomic consume function"
```

---

### Task 2: `credits.ts` — real error contract

**Files:**
- Modify: `src/lib/credits.ts`
- Test: `src/lib/credits.test.ts`

**Interfaces:**
- Produces: `export const DEFAULT_AI_CREDITS = 5`, `export class InsufficientCreditsError extends Error`, real `isInsufficientCreditsError` — used by Task 3 and Task 5.

This file is imported client-side (by `app-shell.tsx`, `dashboard.tsx`,
`studio-camera-drawer.tsx`) as well as server-side, so it must stay free of any
server-only imports.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/credits.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_AI_CREDITS, InsufficientCreditsError, isInsufficientCreditsError } from "./credits";

describe("credit error contract", () => {
  test("DEFAULT_AI_CREDITS is the free-tier daily allowance", () => {
    expect(DEFAULT_AI_CREDITS).toBe(5);
  });

  test("recognizes InsufficientCreditsError", () => {
    expect(isInsufficientCreditsError(new InsufficientCreditsError())).toBe(true);
  });

  test("does not misidentify other errors", () => {
    expect(isInsufficientCreditsError(new Error("some other failure"))).toBe(false);
    expect(isInsufficientCreditsError("not an error")).toBe(false);
    expect(isInsufficientCreditsError(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/credits.test.ts`
Expected: FAIL — `InsufficientCreditsError is not exported`.

- [ ] **Step 3: Implement**

Replace the full contents of `src/lib/credits.ts`:

```ts
export const INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS";

export const DEFAULT_AI_CREDITS = 5;

export class InsufficientCreditsError extends Error {
  constructor() {
    super("You're out of styling credits for today.");
    this.name = INSUFFICIENT_CREDITS;
  }
}

export function isInsufficientCreditsError(err: unknown): boolean {
  return err instanceof Error && err.name === INSUFFICIENT_CREDITS;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/credits.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/credits.ts src/lib/credits.test.ts
git commit -m "feat: add real InsufficientCreditsError contract"
```

---

### Task 3: `consumeAiCredit` — real implementation

**Files:**
- Modify: `src/lib/credits.server.ts`
- Create: `tests/helpers/memory-credit-store.ts`
- Test: `src/lib/credits.server.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_AI_CREDITS`, `InsufficientCreditsError` (Task 2); `supabaseAdmin` (`src/integrations/supabase/client.server.ts`, existing).
- Produces:
  - `export type ConsumeCreditStore = (userId: string, dailyAllowance: number) => Promise<{ allowed: boolean; remaining: number }>`
  - `export async function consumeAiCredit(supabase: SupabaseClient, userId: string, store?: ConsumeCreditStore): Promise<number>` — same call signature the 3 existing call sites already use (`consumeAiCredit(context.supabase, context.userId)`), now with a real 3rd optional param for tests.

- [ ] **Step 1: Write the in-memory fake store**

Create `tests/helpers/memory-credit-store.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/credits.server.test.ts`:

```ts
import { describe, expect, mock, test } from "bun:test";
import { consumeAiCredit } from "./credits.server";
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/lib/credits.server.test.ts`
Expected: FAIL — `ConsumeCreditStore is not exported` (or similar).

- [ ] **Step 4: Implement**

Replace the full contents of `src/lib/credits.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_AI_CREDITS, InsufficientCreditsError } from "./credits";

const IN_FORCE_STATUSES = ["active", "trialing", "past_due"];

export type ConsumeCreditStore = (
  userId: string,
  dailyAllowance: number,
) => Promise<{ allowed: boolean; remaining: number }>;

async function resolveDailyCreditAllowance(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan_id")
    .eq("user_id", userId)
    .in("status", IN_FORCE_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return DEFAULT_AI_CREDITS;

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("credits_included")
    .eq("id", sub.plan_id)
    .maybeSingle();
  return plan?.credits_included ?? DEFAULT_AI_CREDITS;
}

async function supabaseConsumeCreditStore(
  userId: string,
  dailyAllowance: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .rpc("consume_ai_credit", { _user_id: userId, _daily_allowance: dailyAllowance })
    .single();
  if (error) throw error;
  return data as { allowed: boolean; remaining: number };
}

export async function consumeAiCredit(
  supabase: SupabaseClient,
  userId: string,
  store: ConsumeCreditStore = supabaseConsumeCreditStore,
): Promise<number> {
  const dailyAllowance = await resolveDailyCreditAllowance(supabase, userId);
  const result = await store(userId, dailyAllowance);
  if (!result.allowed) throw new InsufficientCreditsError();
  return result.remaining;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/lib/credits.server.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors. The 3 existing call sites (`generate-outfit.functions.ts`,
`dupe-hunter.functions.ts`, `concierge-chat.functions.ts`) call
`consumeAiCredit(context.supabase, context.userId)` with 2 args — this still matches the
new signature since `store` is optional and defaults to the real implementation.

- [ ] **Step 7: Flip the feature flag**

In `src/config/features.ts`, change:
```ts
  creditEnforcement: {
    status: "development",
```
to:
```ts
  creditEnforcement: {
    status: "available",
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/credits.server.ts src/lib/credits.server.test.ts tests/helpers/memory-credit-store.ts src/config/features.ts
git commit -m "feat: enforce real AI credit consumption with daily reset"
```

---

### Task 4: `mySubscriptionQueryOptions` gains `credits_included`

**Files:**
- Modify: `src/lib/queries/subscriptions.ts`

**Interfaces:**
- Produces: `MySubscription.credits_included: number` — used by Task 5.

- [ ] **Step 1: Add the field**

In `src/lib/queries/subscriptions.ts`, update the interface and the second query's
`select` and return value:

```ts
export interface MySubscription {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  plan_title: string;
  credits_included: number;
  price_amount: number;
  currency: string;
  billing_interval: BillingInterval;
}
```

```ts
      const { data: plan, error: planError } = await supabase
        .from("subscription_plans")
        .select("title, credits_included, price_amount, currency, billing_interval")
        .eq("id", sub.plan_id)
        .maybeSingle();
      if (planError || !plan) return null;

      return {
        status: sub.status,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        plan_title: plan.title,
        credits_included: plan.credits_included,
        price_amount: plan.price_amount,
        currency: plan.currency,
        billing_interval: plan.billing_interval as BillingInterval,
      };
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/subscriptions.ts
git commit -m "feat: expose credits_included on mySubscriptionQueryOptions"
```

---

### Task 5: `CreditsUsageMeter` component

**Files:**
- Create: `src/lib/credits-countdown.ts`
- Test: `src/lib/credits-countdown.test.ts`
- Create: `src/components/account/credits-usage-meter.tsx`

**Interfaces:**
- Produces: `export function formatResetCountdown(now: Date): string`; `export function CreditsUsageMeter({ remaining, total }: { remaining: number; total: number })` — used by Task 6.

The countdown formatter is a pure function extracted into its own non-JSX file so it's
directly `bun:test`-able (this repo has zero `*.test.tsx` files — component behavior is
verified manually, pure logic gets unit tests, same split used in every prior
sub-project).

- [ ] **Step 1: Write the failing test**

Create `src/lib/credits-countdown.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { formatResetCountdown } from "./credits-countdown";

describe("formatResetCountdown", () => {
  test("counts down to the next UTC midnight", () => {
    expect(formatResetCountdown(new Date("2026-07-24T23:45:00Z"))).toBe("0h 15m");
  });

  test("shows a full day right after a reset", () => {
    expect(formatResetCountdown(new Date("2026-07-24T00:00:00Z"))).toBe("24h 0m");
  });

  test("rounds up partial minutes so it never shows a stale zero", () => {
    expect(formatResetCountdown(new Date("2026-07-24T23:59:30Z"))).toBe("0h 1m");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/credits-countdown.test.ts`
Expected: FAIL — `Cannot find module './credits-countdown'`.

- [ ] **Step 3: Implement the countdown formatter**

Create `src/lib/credits-countdown.ts`:

```ts
export function formatResetCountdown(now: Date): string {
  const nextMidnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const msRemaining = nextMidnightUtc - now.getTime();
  const totalMinutes = Math.max(0, Math.ceil(msRemaining / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/credits-countdown.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Write the component**

Create `src/components/account/credits-usage-meter.tsx`:

```tsx
import { useEffect, useState } from "react";
import { formatResetCountdown } from "@/lib/credits-countdown";

export function CreditsUsageMeter({ remaining, total }: { remaining: number; total: number }) {
  const [countdown, setCountdown] = useState(() => formatResetCountdown(new Date()));

  useEffect(() => {
    const id = setInterval(() => setCountdown(formatResetCountdown(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  const clampedRemaining = Math.max(0, Math.min(remaining, total));
  const percentUsed = total > 0 ? Math.round(((total - clampedRemaining) / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="uppercase tracking-[0.2em] text-[10px] text-stone">Styling Credits</span>
        <span className="font-semibold text-ink tabular-nums">
          {clampedRemaining} of {total} left today
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-porcelain/60">
        <div
          className="h-full rounded-full bg-ink transition-all"
          style={{ width: `${100 - percentUsed}%` }}
        />
      </div>
      <p className="text-[10px] text-stone">Resets in {countdown}</p>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/credits-countdown.ts src/lib/credits-countdown.test.ts src/components/account/credits-usage-meter.tsx
git commit -m "feat: add CreditsUsageMeter component"
```

---

### Task 6: Wire the meter into the membership drawer, add the paywall upgrade link

**Files:**
- Modify: `src/components/account/studio-membership-drawer.tsx`
- Modify: `src/components/dashboard/upgrade-slots-dialog.tsx`

**Interfaces:**
- Consumes: `CreditsUsageMeter` (Task 5), `DEFAULT_AI_CREDITS` (Task 2), `MySubscription.credits_included` (Task 4).

- [ ] **Step 1: Update imports in the drawer**

In `src/components/account/studio-membership-drawer.tsx`, replace:
```ts
import { DevelopmentBadge } from "@/components/ui/development-badge";
import { DevelopmentNotice } from "@/components/ui/development-notice";
```
with:
```ts
import { CreditsUsageMeter } from "@/components/account/credits-usage-meter";
import { DEFAULT_AI_CREDITS } from "@/lib/credits";
```

- [ ] **Step 2: Remove the now-redundant raw credits line**

Find and remove this block (the usage meter added in Step 3 below replaces it):
```tsx
                    {credits != null && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="uppercase tracking-[0.2em text-[10px] text-stone">
                          Styling Credits
                        </span>
                        <span className="font-semibold text-ink tabular-nums">{credits}</span>
                      </div>
                    )}
```

- [ ] **Step 3: Replace the dead "in development" block with the meter**

Find this block:
```tsx
                  {/*
                    IN DEVELOPMENT [membership-passes]:
                    No pass-acquisition or partner-editorial flow is wired
                    up yet — both controls are disabled so nothing fires
                    silently when clicked.
                    See /IN_DEVELOPMENT.txt.
                  */}
                  <div className="space-y-3">
                    <button
                      type="button"
                      disabled
                      aria-describedby="membership-passes-development-message"
                      className="w-full py-3 rounded-lg bg-ink text-white text-[11px] uppercase tracking-[0.25em] font-semibold opacity-50 cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      Acquire Passes
                      <DevelopmentBadge className="bg-white/15 text-white border-white/25" />
                    </button>

                    <button
                      type="button"
                      disabled
                      aria-describedby="membership-passes-development-message"
                      className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-[11px] uppercase tracking-[0.25em] text-ink opacity-60 cursor-not-allowed flex items-center justify-center gap-3"
                    >
                      <span>View Partner Editorial</span>
                      <span className="text-[9px] text-stone normal-case tracking-normal">
                        +1 Pass
                      </span>
                    </button>

                    <DevelopmentNotice
                      id="membership-passes-development-message"
                      description="Experience a brief presentation from our luxury partners to receive a complimentary styling pass. This action is not available yet."
                    />
                  </div>
```

Replace it with:
```tsx
                  <CreditsUsageMeter
                    remaining={credits ?? DEFAULT_AI_CREDITS}
                    total={subscription?.credits_included ?? DEFAULT_AI_CREDITS}
                  />
```

- [ ] **Step 4: Add the upgrade link to the paywall dialog**

In `src/components/dashboard/upgrade-slots-dialog.tsx`, add to the imports:
```ts
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
```

Then, immediately after the closing `</DialogHeader>` tag and before the
`<div className="mt-2 space-y-3">` (the `CREDIT_PACKS` list), insert:
```tsx
        <Button asChild className="w-full" onClick={() => onOpenChange(false)}>
          <Link to="/pricing">View Membership Plans</Link>
        </Button>
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/account/studio-membership-drawer.tsx src/components/dashboard/upgrade-slots-dialog.tsx
git commit -m "feat: show real credit usage meter, add upgrade link to the paywall"
```

---

### Task 7: Update live plan data

**Files:** none (data only, via the service-role client)

**Interfaces:** none

- [ ] **Step 1: Update Atelier Elite's daily allowance and all 3 plans' feature copy**

Run:
```bash
set -a && source .env && set +a && node -e '
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const updates = [
  {
    slug: "starter",
    credits_included: 25,
    features: ["25 styling credits per day", "Save outfits to your closet", "Style history & favorites", "Email support"],
  },
  {
    slug: "style-pro",
    credits_included: 100,
    features: ["100 styling credits per day", "Save outfits to your closet", "Style history & favorites", "Email support"],
  },
  {
    slug: "atelier-elite",
    credits_included: 150,
    features: ["150 styling credits per day", "Save outfits to your closet", "Style history & favorites", "Email support"],
  },
];

(async () => {
  for (const u of updates) {
    const { error } = await db
      .from("subscription_plans")
      .update({ credits_included: u.credits_included, features: u.features })
      .eq("slug", u.slug);
    if (error) throw error;
    console.log(u.slug, "updated");
  }
  const { data } = await db
    .from("subscription_plans")
    .select("slug,credits_included,features")
    .order("sort_order");
  console.log(JSON.stringify(data, null, 2));
})();
'
```
Expected: three `<slug> updated` lines, then a printout confirming `credits_included` is
`25`/`100`/`150` and all 3 `features` arrays match.

- [ ] **Step 2: No commit needed**

This step only changed database rows — there's no file to commit.

---

### Task 8: Manual acceptance test

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the full automated suite one more time**

Run:
```bash
bun run typecheck && bun test
```
Expected: no typecheck errors, all tests pass (should now include the new tests from
Tasks 2, 3, and 5 alongside every prior sub-project's tests).

- [ ] **Step 2: Consume real credits and watch the meter**

```bash
bun run dev > /tmp/dev-server.log 2>&1 &
sleep 4
```

Sign in as a user with a completed style profile, generate an outfit on `/dashboard`
(this calls `generateDailyLook`, which calls `consumeAiCredit`). Open the membership
drawer and confirm the usage meter now shows one fewer credit remaining than before, and
"Resets in `{Xh Ym}`" counting down to UTC midnight.

- [ ] **Step 3: Force credits to zero and confirm the paywall**

Run (substitute the real user's id):
```bash
set -a && source .env && set +a && node -e '
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
db.from("user_entitlements").update({ ai_credits: 0 }).eq("user_id", "<user-id>")
  .then(({ error }) => console.log(error ? JSON.stringify(error) : "credits zeroed"));
'
```

Try generating another outfit. Expected: the `UpgradeSlotsDialog` ("Studio Energy
Depleted") opens, and it now shows a working "View Membership Plans" button that
navigates to `/pricing`.

- [ ] **Step 4: Force a day-boundary reset**

Run (substitute the real user's id, and back-date `credits_reset_at`):
```bash
set -a && source .env && set +a && node -e '
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
db.from("user_entitlements").update({ ai_credits: 0, credits_reset_at: "2020-01-01" }).eq("user_id", "<user-id>")
  .then(({ error }) => console.log(error ? JSON.stringify(error) : "backdated"));
'
```

Generate another outfit. Expected: it succeeds (no paywall), and the membership drawer's
meter shows the plan's full daily allowance minus 1 — confirming the lazy reset fired.

- [ ] **Step 5: Stop the dev server**

```bash
kill %1 2>/dev/null
```

## Summary

| Task | Deliverable |
|---|---|
| 1 | `credits_reset_at` column + atomic `consume_ai_credit` Postgres function |
| 2 | Real `InsufficientCreditsError` / `isInsufficientCreditsError` contract (4 tests total across both files split) |
| 3 | Real `consumeAiCredit` with daily-allowance resolution, tested against an in-memory fake store (4 tests), `creditEnforcement` flag flipped |
| 4 | `MySubscription.credits_included` exposed |
| 5 | `CreditsUsageMeter` component + pure countdown formatter (3 tests) |
| 6 | Drawer shows the real meter, paywall dialog has a working upgrade link |
| 7 | Live plan data updated: uniform feature copy, Elite's daily allowance corrected to 150 |
| 8 | Full manual acceptance pass: consumption, paywall, day-boundary reset |
