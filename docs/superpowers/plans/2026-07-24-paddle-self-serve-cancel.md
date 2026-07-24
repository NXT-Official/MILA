# Paddle Self-Serve Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the membership drawer's hardcoded "Current Tier: Free" with real subscription state, and add a Cancel Membership button that schedules cancellation via Paddle.

**Architecture:** A read-only query (`mySubscriptionQueryOptions`) drives the drawer's display; a `createServerFn` (`cancelMySubscription`) wraps a small injectable, unit-tested function (`cancelSubscriptionForUser`) that looks up the caller's own in-force subscription and cancels it via a direct Paddle API call — no `subscriptionId` ever crosses the client/server boundary.

**Tech Stack:** TanStack Start (`createServerFn`), `@tanstack/react-query` 5, Supabase, `bun:test`.

## Global Constraints

- `effective_from` is always `"next_billing_period"` — no "cancel immediately" option is exposed anywhere (spec: "Architecture").
- `cancelMySubscription` takes no `subscriptionId` input; it looks up the caller's own subscription server-side via `context.userId` (spec: "Architecture" — deliberately simpler than the reference `subscription-cancel` skill's ownership-check pattern).
- Calls Paddle via raw `fetch` with `PADDLE_SANDBOX_API_KEY` — no `@paddle/paddle-node-sdk` dependency (matches sub-projects #1/#2's convention).
- No resume/undo, no immediate-cancel, no plan switching, no Paddle-hosted Customer Portal (spec: "Scope", "Cancel approach").
- Match existing conventions: co-located `*.test.ts` via `bun:test` for pure/injectable logic only (this repo has zero `*.test.tsx`); dependency-injection test pattern from `auth-handler.server.ts` / `paddle-webhook.server.ts`; dedicated dialog components matching `role-confirmation-dialog.tsx`'s structure.

---

### Task 1: `mySubscriptionQueryOptions`

**Files:**
- Modify: `src/constants/query-keys.ts`
- Create: `src/lib/queries/subscriptions.ts`

**Interfaces:**
- Produces: `queryKeys.mySubscription(userId)`; `export interface MySubscription { status: string; current_period_end: string | null; cancel_at_period_end: boolean; plan_title: string; price_amount: number; currency: string; billing_interval: BillingInterval }`; `export function mySubscriptionQueryOptions(userId: string | undefined)` — used by Task 4.

Two plain queries (subscription row, then its plan), not a PostgREST embedded select. The
`subscriptions_plan_id_fkey`/`subscriptions_user_id_fkey` relationships added to
`types.ts` in sub-project #1 have never actually been exercised by an embedded `select()`
anywhere in this codebase — there's no precedent to confirm whether `isOneToOne: false`
resolves to an object or an array at the call site. Two plain selects, mirroring the
already-proven `PUBLIC_PLAN_COLUMNS` pattern in `src/lib/queries/subscription-plans.ts`,
avoids that uncertainty entirely for a two-query cost that's irrelevant at this scale.

- [ ] **Step 1: Add the query key**

In `src/constants/query-keys.ts`, add to the `queryKeys` object (after `credits`):

```ts
  mySubscription: (userId: string | undefined) => ["my-subscription", userId] as const,
```

- [ ] **Step 2: Write the query**

Create `src/lib/queries/subscriptions.ts`:

```ts
import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { supabase } from "@/integrations/supabase/client";
import type { BillingInterval } from "@/lib/subscription-plans";

export interface MySubscription {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  plan_title: string;
  price_amount: number;
  currency: string;
  billing_interval: BillingInterval;
}

const IN_FORCE_STATUSES = ["active", "trialing", "past_due"];

export function mySubscriptionQueryOptions(userId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.mySubscription(userId),
    queryFn: async (): Promise<MySubscription | null> => {
      if (!userId) return null;

      const { data: sub, error: subError } = await supabase
        .from("subscriptions")
        .select("plan_id, status, current_period_end, cancel_at_period_end")
        .eq("user_id", userId)
        .in("status", IN_FORCE_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (subError || !sub) return null;

      // ponytail: if an admin deactivates/archives a plan a user is still
      // subscribed to, RLS hides it here and the drawer falls back to
      // "Free" even though the subscription is real. Low-probability in a
      // 3-plan sandbox catalog; revisit if plan lifecycle management
      // becomes a real feature.
      const { data: plan, error: planError } = await supabase
        .from("subscription_plans")
        .select("title, price_amount, currency, billing_interval")
        .eq("id", sub.plan_id)
        .maybeSingle();
      if (planError || !plan) return null;

      return {
        status: sub.status,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        plan_title: plan.title,
        price_amount: plan.price_amount,
        currency: plan.currency,
        billing_interval: plan.billing_interval as BillingInterval,
      };
    },
    enabled: !!userId,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/constants/query-keys.ts src/lib/queries/subscriptions.ts
git commit -m "feat: add mySubscriptionQueryOptions"
```

---

### Task 2: `cancelSubscriptionForUser` + `cancelMySubscription`

**Files:**
- Create: `src/lib/subscriptions.functions.ts`
- Test: `src/lib/subscriptions.functions.test.ts`

**Interfaces:**
- Consumes: `requireEnv` (`src/lib/env.ts`), `requireSupabaseAuth` (`src/integrations/supabase/auth-middleware.ts`).
- Produces:
  - `export type CancelSubscriptionResult = { success: true; endsAt: string } | { error: string }`
  - `export async function cancelSubscriptionForUser(db: SupabaseClient<Database>, cancelViaPaddle: (paddleSubscriptionId: string) => Promise<{ endsAt: string } | { error: unknown }>, userId: string): Promise<CancelSubscriptionResult>`
  - `export const cancelMySubscription` — a `createServerFn`, used by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/subscriptions.functions.test.ts`:

```ts
import { describe, expect, mock, test } from "bun:test";
import { cancelSubscriptionForUser } from "./subscriptions.functions";

function fakeDb(row: { paddle_subscription_id: string } | null) {
  const chain = {
    select: (..._args: unknown[]) => chain,
    eq: (..._args: unknown[]) => chain,
    in: (..._args: unknown[]) => chain,
    order: (..._args: unknown[]) => chain,
    limit: (..._args: unknown[]) => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: mock(() => chain) } as unknown as Parameters<typeof cancelSubscriptionForUser>[0];
}

describe("cancelSubscriptionForUser", () => {
  test("returns an error when the user has no in-force subscription", async () => {
    const db = fakeDb(null);
    const cancelViaPaddle = mock(async () => ({ endsAt: "2026-09-01" }));

    const result = await cancelSubscriptionForUser(db, cancelViaPaddle, "user-1");

    expect(result).toEqual({ error: "No active membership to cancel" });
    expect(cancelViaPaddle).not.toHaveBeenCalled();
  });

  test("cancels the user's subscription and returns the scheduled end date", async () => {
    const db = fakeDb({ paddle_subscription_id: "sub_123" });
    const cancelViaPaddle = mock(async () => ({ endsAt: "2026-09-01" }));

    const result = await cancelSubscriptionForUser(db, cancelViaPaddle, "user-1");

    expect(result).toEqual({ success: true, endsAt: "2026-09-01" });
    expect(cancelViaPaddle).toHaveBeenCalledWith("sub_123");
  });

  test("surfaces a generic error when Paddle's cancel call fails", async () => {
    const db = fakeDb({ paddle_subscription_id: "sub_123" });
    const cancelViaPaddle = mock(async () => ({ error: { status: 500 } }));

    const result = await cancelSubscriptionForUser(db, cancelViaPaddle, "user-1");

    expect(result).toEqual({ error: "Couldn't cancel your membership. Try again in a moment." });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/subscriptions.functions.test.ts`
Expected: FAIL — `Cannot find module './subscriptions.functions'`.

- [ ] **Step 3: Implement**

Create `src/lib/subscriptions.functions.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "@/lib/env";

type MilaSupabaseClient = SupabaseClient<Database>;

const IN_FORCE_STATUSES = ["active", "trialing", "past_due"];

export type CancelSubscriptionResult = { success: true; endsAt: string } | { error: string };

export async function cancelSubscriptionForUser(
  db: MilaSupabaseClient,
  cancelViaPaddle: (paddleSubscriptionId: string) => Promise<{ endsAt: string } | { error: unknown }>,
  userId: string,
): Promise<CancelSubscriptionResult> {
  const { data: subscription, error } = await db
    .from("subscriptions")
    .select("paddle_subscription_id")
    .eq("user_id", userId)
    .in("status", IN_FORCE_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !subscription) {
    return { error: "No active membership to cancel" };
  }

  const result = await cancelViaPaddle(subscription.paddle_subscription_id);
  if ("error" in result) {
    return { error: "Couldn't cancel your membership. Try again in a moment." };
  }
  return { success: true, endsAt: result.endsAt };
}

async function cancelViaPaddleApi(
  paddleSubscriptionId: string,
): Promise<{ endsAt: string } | { error: unknown }> {
  const { PADDLE_SANDBOX_API_KEY } = requireEnv({
    PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
  });

  const res = await fetch(
    `https://sandbox-api.paddle.com/subscriptions/${paddleSubscriptionId}/cancel`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${PADDLE_SANDBOX_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ effective_from: "next_billing_period" }),
    },
  );
  const json = await res.json();
  if (!res.ok) {
    console.error("[cancelMySubscription] Paddle cancel failed", json);
    return { error: json };
  }

  const endsAt: string | undefined =
    json.data?.scheduled_change?.effective_at ?? json.data?.current_billing_period?.ends_at;
  if (!endsAt) {
    console.error("[cancelMySubscription] Paddle response missing an end date", json);
    return { error: json };
  }
  return { endsAt };
}

export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CancelSubscriptionResult> => {
    return cancelSubscriptionForUser(context.supabase, cancelViaPaddleApi, context.userId);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/subscriptions.functions.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/subscriptions.functions.ts src/lib/subscriptions.functions.test.ts
git commit -m "feat: add cancelMySubscription server function"
```

---

### Task 3: `CancelMembershipDialog`

**Files:**
- Create: `src/components/account/cancel-membership-dialog.tsx`

**Interfaces:**
- Consumes: `Dialog`/`DialogContent`/`DialogDescription`/`DialogFooter`/`DialogHeader`/`DialogTitle` (`src/components/ui/dialog.tsx`), `Button` (`src/components/ui/button.tsx`, has a built-in `loading` prop).
- Produces: `export function CancelMembershipDialog({ open, endsAt, pending, onOpenChange, onConfirm }: { open: boolean; endsAt: string; pending: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void })` — used by Task 4.

Structure mirrors the existing `src/components/admin/role-confirmation-dialog.tsx` confirm-dialog pattern.

- [ ] **Step 1: Write the component**

Create `src/components/account/cancel-membership-dialog.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CancelMembershipDialog({
  open,
  endsAt,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  endsAt: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel your membership?</DialogTitle>
          <DialogDescription>
            You'll keep access until {new Date(endsAt).toLocaleDateString()}. After that, your
            plan won't renew.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep Membership
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={pending}>
            Cancel Membership
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Note: `endsAt` here is today's date as a placeholder shown while the confirmation is open
(before the user has confirmed and Paddle has returned the real scheduled date) — Task 4
passes the current period's `current_period_end` from the subscription query, which is the
best information available at confirm-time. It's superseded by the real
`scheduled_change.effective_at` from the cancel response once the user actually confirms.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/cancel-membership-dialog.tsx
git commit -m "feat: add CancelMembershipDialog"
```

---

### Task 4: Wire `StudioMembershipDrawer`

**Files:**
- Modify: `src/components/account/studio-membership-drawer.tsx`

**Interfaces:**
- Consumes: `mySubscriptionQueryOptions`, `MySubscription` (Task 1); `cancelMySubscription`, `CancelSubscriptionResult` (Task 2); `CancelMembershipDialog` (Task 3).

- [ ] **Step 1: Add imports**

In `src/components/account/studio-membership-drawer.tsx`, add to the top imports (after the
existing `import { toast } from "sonner";` line):

```ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { queryKeys } from "@/constants/query-keys";
import { mySubscriptionQueryOptions } from "@/lib/queries/subscriptions";
import { cancelMySubscription } from "@/lib/subscriptions.functions";
import { CancelMembershipDialog } from "@/components/account/cancel-membership-dialog";
```

- [ ] **Step 2: Add subscription state**

In the `StudioMembershipDrawer` component body, immediately after this existing line:

```ts
  const { user: authUser, signOut, signingOut } = useAuth();
```

add:

```ts
  const queryClient = useQueryClient();
  const { data: subscription } = useQuery({
    ...mySubscriptionQueryOptions(authUser?.id),
    enabled: !!authUser,
  });
  const cancelSubscription = useServerFn(cancelMySubscription);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);

  async function handleConfirmCancel() {
    setCanceling(true);
    try {
      const result = await cancelSubscription();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Your membership ends on ${new Date(result.endsAt).toLocaleDateString()}.`);
      setCancelDialogOpen(false);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.mySubscription(authUser?.id) });
      }, 4000);
    } finally {
      setCanceling(false);
    }
  }
```

- [ ] **Step 3: Replace the "Current Tier" block**

Find this exact block (inside the `view === "membership"` branch):

```tsx
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="uppercase tracking-[0.2em] text-stone text-[10px]">
                        Current Tier
                      </span>
                      <span className="font-semibold text-ink">Free</span>
                    </div>
                    {credits != null && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="uppercase tracking-[0.2em text-[10px] text-stone">
                          Styling Credits
                        </span>
                        <span className="font-semibold text-ink tabular-nums">{credits}</span>
                      </div>
                    )}
                    <p className="pt-1 text-xs leading-relaxed text-stone">
                      Compare Atelier memberships and their included styling credits on the plans
                      page.
                    </p>
                    <Link
                      to="/pricing"
                      onClick={onClose}
                      className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-[11px] uppercase tracking-[0.25em] text-ink hover:bg-accent-soft dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                    >
                      View Membership Plans
                      <span aria-hidden="true">→</span>
                    </Link>
                  </div>
```

Replace it with:

```tsx
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="uppercase tracking-[0.2em] text-stone text-[10px]">
                        Current Tier
                      </span>
                      <span className="font-semibold text-ink">
                        {subscription ? subscription.plan_title : "Free"}
                      </span>
                    </div>
                    {credits != null && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="uppercase tracking-[0.2em text-[10px] text-stone">
                          Styling Credits
                        </span>
                        <span className="font-semibold text-ink tabular-nums">{credits}</span>
                      </div>
                    )}
                    {subscription ? (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="uppercase tracking-[0.2em] text-[10px] text-stone">
                            {subscription.cancel_at_period_end ? "Ends" : "Renews"}
                          </span>
                          <span className="font-semibold text-ink">
                            {subscription.current_period_end
                              ? new Date(subscription.current_period_end).toLocaleDateString()
                              : "—"}
                          </span>
                        </div>
                        {!subscription.cancel_at_period_end && (
                          <button
                            type="button"
                            onClick={() => setCancelDialogOpen(true)}
                            className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-[11px] uppercase tracking-[0.25em] text-ink hover:bg-accent-soft dark:hover:bg-white/10 transition-colors"
                          >
                            Cancel Membership
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="pt-1 text-xs leading-relaxed text-stone">
                          Compare Atelier memberships and their included styling credits on the plans
                          page.
                        </p>
                        <Link
                          to="/pricing"
                          onClick={onClose}
                          className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-[11px] uppercase tracking-[0.25em] text-ink hover:bg-accent-soft dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                        >
                          View Membership Plans
                          <span aria-hidden="true">→</span>
                        </Link>
                      </>
                    )}
                  </div>
```

- [ ] **Step 4: Render the confirmation dialog**

Find the end of the component's returned JSX:

```tsx
        </div>
      </SheetContent>
    </Sheet>
  );
```

Replace it with (adds the dialog as a sibling, only rendered when a cancellable
subscription exists):

```tsx
        </div>
      </SheetContent>

      {subscription && !subscription.cancel_at_period_end && (
        <CancelMembershipDialog
          open={cancelDialogOpen}
          endsAt={subscription.current_period_end ?? new Date().toISOString()}
          pending={canceling}
          onOpenChange={setCancelDialogOpen}
          onConfirm={handleConfirmCancel}
        />
      )}
    </Sheet>
  );
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/account/studio-membership-drawer.tsx
git commit -m "feat: show real membership state and wire Cancel Membership in the drawer"
```

---

### Task 5: Manual sandbox cancel acceptance test

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Complete a fresh sandbox checkout**

```bash
bun run dev > /tmp/dev-server.log 2>&1 &
sleep 4
```

Sign in, go to `/pricing`, subscribe to any plan with the sandbox test card
(`4242 4242 4242 4242`, any future expiry, any 3-digit CVC) — same flow verified working in
sub-project #2.

- [ ] **Step 2: Confirm the drawer shows the real plan**

Open the membership drawer ("Open membership" button in the nav). Expected: "Current Tier"
shows the plan just purchased (not "Free"), "Renews" shows a future date, and a "Cancel
Membership" button is present.

- [ ] **Step 3: Cancel and confirm the dialog**

Click "Cancel Membership". Expected: the confirmation dialog opens with "You'll keep access
until `<date>`." Click "Cancel Membership" in the dialog.

Expected: a success toast ("Your membership ends on `<date>`."), the dialog closes.

- [ ] **Step 4: Confirm the webhook lands and the drawer updates**

This requires a webhook receiver reachable from Paddle — set one up the same way as
sub-project #1/#2's Task 6 (tunnel + `notification-settings` destination pointing at
`<tunnel-url>/api/webhooks/paddle`, `PADDLE_SANDBOX_WEBHOOK_SECRET` updated in `.env`, dev
server restarted) if one isn't already live.

Run, a few seconds after confirming cancel:
```bash
set -a && source .env && set +a && node -e '
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
db.from("subscriptions").select("status, cancel_at_period_end, current_period_end")
  .order("updated_at", { ascending: false }).limit(1)
  .then(({ data, error }) => console.log(JSON.stringify({ data, error }, null, 2)));
'
```
Expected: `cancel_at_period_end: true`, `status` still `active` (not yet the terminal
state — that only happens once the real billing period ends). Reopen the drawer in the
browser (or wait ~4s for the automatic invalidation) and confirm it now shows "Ends
`<date>`" with no Cancel Membership button.

- [ ] **Step 5: Clean up**

Delete any test notification destination created for this test (same pattern as prior
sub-projects' Task 6):
```bash
set -a && source .env && set +a && node -e '
const key = process.env.PADDLE_SANDBOX_API_KEY;
fetch("https://sandbox-api.paddle.com/notification-settings", {
  headers: { Authorization: `Bearer ${key}` },
}).then(async r => console.log(JSON.stringify(await r.json())));
'
```
Note any `id` returned and `DELETE` it the same way prior sub-projects did. Stop the dev
server and any tunnel:
```bash
kill %1 %2 2>/dev/null
```

## Summary

| Task | Deliverable |
|---|---|
| 1 | `mySubscriptionQueryOptions` — reads the caller's own in-force subscription + plan |
| 2 | `cancelSubscriptionForUser` (3 unit tests) + `cancelMySubscription` server function |
| 3 | `CancelMembershipDialog` confirmation component |
| 4 | Drawer shows real plan/renewal state, Cancel Membership wired end to end |
| 5 | Full sandbox cancel completed, webhook-driven state update confirmed |
