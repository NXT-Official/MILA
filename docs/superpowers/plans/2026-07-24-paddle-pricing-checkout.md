# Paddle Pricing Page Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the pricing page's existing (disabled) "Choose Plan" button to a real Paddle overlay checkout, so `custom_data.user_id` flows through to the webhook sync built in sub-project #1.

**Architecture:** `@paddle/paddle-js` overlay checkout, opened from a small hook (`use-paddle-checkout.ts`) that wraps a singleton `initializePaddle()` call. A pure `buildCheckoutOptions()` function is the one piece of real logic (and the one thing worth unit-testing) — everything else is UI wiring plus a CSP allowance for Paddle's script/iframe.

**Tech Stack:** React 19, `@tanstack/react-query` 5, `@paddle/paddle-js`, `sonner` (toast), Vite 7, `bun:test`.

## Global Constraints

- Checkout style is **overlay**, not inline (spec: "Checkout style").
- No "current plan" / duplicate-purchase guard on this page — every plan's button opens checkout regardless of the user's existing subscription state (spec: "Scope" — that belongs to a future subscription-update sub-project).
- Provisioning happens via the webhook (sub-project #1), never the client-side redirect/event — this page only shows a toast and invalidates the credits query (spec: "Post-checkout UX").
- Env vars use the existing `VITE_`-prefixed public-key convention, not Next.js's `NEXT_PUBLIC_` (this is TanStack Start + Vite, not Next.js — the `paddle:checkout-web` skill's examples use `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`; translate to `VITE_PADDLE_CLIENT_TOKEN`).
- No new dependency beyond `@paddle/paddle-js` itself.
- Match existing conventions: co-located `*.test.ts` via `bun:test` for pure logic only (this repo has zero `*.test.tsx` — hooks/components aren't unit-tested here, verified manually instead).

---

### Task 1: Install `@paddle/paddle-js` and provision the client token

**Files:**
- Modify: `package.json`, `bun.lock` (via `bun add`)
- Modify: `.env` (local, untracked), `.env.example`

**Interfaces:**
- Produces: `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENV` available via `import.meta.env` for Task 3.

- [ ] **Step 1: Install the package**

Run:
```bash
bun add @paddle/paddle-js
```
Expected: `package.json` gains a `"@paddle/paddle-js": "^..."` dependency; `bun.lock` updates.

- [ ] **Step 2: Create a client-side token via the Paddle API**

The sandbox API key in `.env` (`PADDLE_SANDBOX_API_KEY`) already works for direct API calls
(proven in sub-project #1). Run:
```bash
set -a && source .env && set +a && node -e '
const key = process.env.PADDLE_SANDBOX_API_KEY;
fetch("https://sandbox-api.paddle.com/client-tokens", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "mila pricing page checkout" }),
}).then(async r => {
  const j = await r.json();
  console.log(r.status, JSON.stringify(j));
});
'
```
Expected: `201` with `data.token` starting with `test_...`. If it prints `403 forbidden`, the
API key needs the **Client-side tokens** permission added — ask the user to add it under
**Paddle > Developer tools > Authentication**, the same way `notification-settings` and
`simulations` write scopes were added in sub-project #1, then retry.

- [ ] **Step 3: Add the env vars**

In `.env` (local only, not committed), add:
```
VITE_PADDLE_CLIENT_TOKEN="<data.token from Step 2>"
VITE_PADDLE_ENV="sandbox"
```

In `.env.example`, add:
```
VITE_PADDLE_CLIENT_TOKEN=
VITE_PADDLE_ENV=
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock .env.example
git commit -m "feat: add @paddle/paddle-js and Paddle client token env vars"
```

---

### Task 2: Expose `paddle_price_id` on the public plans query

**Files:**
- Modify: `src/lib/subscription-plans.ts:44-58` (`PublicSubscriptionPlan`, `PUBLIC_PLAN_COLUMNS`)

**Interfaces:**
- Produces: `PublicSubscriptionPlan.paddle_price_id: string | null`, used by Task 3's `buildCheckoutOptions` and Task 4's `PricingCard`.

`paddle_price_id` is not sensitive (RLS already allows authenticated read of active plan
rows; this only changes which *columns* the public query selects), and it's read-only
column exposure — no RLS/migration change needed.

- [ ] **Step 1: Add the field**

In `src/lib/subscription-plans.ts`, update:

```ts
export type PublicSubscriptionPlan = Pick<
  SubscriptionPlan,
  | "id"
  | "slug"
  | "title"
  | "description"
  | "price_amount"
  | "currency"
  | "billing_interval"
  | "credits_included"
  | "features"
  | "is_featured"
  | "paddle_price_id"
>;

export const PUBLIC_PLAN_COLUMNS =
  "id,slug,title,description,price_amount,currency,billing_interval,credits_included,features,is_featured,paddle_price_id";
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/subscription-plans.ts
git commit -m "feat: expose paddle_price_id on the public subscription plans query"
```

---

### Task 3: `buildCheckoutOptions` + `usePaddleCheckout` hook

**Files:**
- Create: `src/hooks/use-paddle-checkout.ts`
- Test: `src/hooks/use-paddle-checkout.test.ts`

**Interfaces:**
- Consumes: `PublicSubscriptionPlan` (Task 2), `queryKeys.credits` (`src/constants/query-keys.ts`, already exists).
- Produces:
  - `export function buildCheckoutOptions(plan: Pick<PublicSubscriptionPlan, "paddle_price_id">, user: { id: string; email?: string }): Parameters<Paddle["Checkout"]["open"]>[0]`
  - `export function usePaddleCheckout(userId: string | undefined): { openCheckout: (plan: Pick<PublicSubscriptionPlan, "paddle_price_id">, user: { id: string; email?: string }) => void; ready: boolean }` — used by Task 4's `pricing.tsx`.

- [ ] **Step 1: Write the failing test for `buildCheckoutOptions`**

Create `src/hooks/use-paddle-checkout.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildCheckoutOptions } from "./use-paddle-checkout";

describe("buildCheckoutOptions", () => {
  test("wires the plan's price id and the user's id into custom_data", () => {
    const options = buildCheckoutOptions(
      { paddle_price_id: "pri_01abc" },
      { id: "user-1", email: "jane@example.com" },
    );

    expect(options.items).toEqual([{ priceId: "pri_01abc", quantity: 1 }]);
    expect(options.customData).toEqual({ user_id: "user-1" });
    expect(options.customer).toEqual({ email: "jane@example.com" });
  });

  test("omits customer prefill when the user has no email", () => {
    const options = buildCheckoutOptions({ paddle_price_id: "pri_01abc" }, { id: "user-1" });

    expect(options.customer).toBeUndefined();
  });

  test("falls back to an empty price id when the plan has none set", () => {
    const options = buildCheckoutOptions({ paddle_price_id: null }, { id: "user-1" });

    expect(options.items).toEqual([{ priceId: "", quantity: 1 }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/hooks/use-paddle-checkout.test.ts`
Expected: FAIL — `Cannot find module './use-paddle-checkout'`.

- [ ] **Step 3: Implement**

Create `src/hooks/use-paddle-checkout.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/constants/query-keys";
import type { PublicSubscriptionPlan } from "@/lib/subscription-plans";

type CheckoutOpenOptions = Parameters<Paddle["Checkout"]["open"]>[0];
type PaddleEvent = { name?: string };

export function buildCheckoutOptions(
  plan: Pick<PublicSubscriptionPlan, "paddle_price_id">,
  user: { id: string; email?: string },
): CheckoutOpenOptions {
  return {
    items: [{ priceId: plan.paddle_price_id ?? "", quantity: 1 }],
    ...(user.email ? { customer: { email: user.email } } : {}),
    customData: { user_id: user.id },
    settings: { variant: "one-page" },
  };
}

let paddlePromise: Promise<Paddle | null> | null = null;
let activeEventHandler: ((event: PaddleEvent) => void) | null = null;

function getPaddle(): Promise<Paddle | null> {
  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
  const environment = import.meta.env.VITE_PADDLE_ENV as "sandbox" | "production" | undefined;
  if (!token || !environment) return Promise.resolve(null);
  if (!paddlePromise) {
    paddlePromise = initializePaddle({
      token,
      environment,
      eventCallback: (event) => activeEventHandler?.(event),
    }).then((p) => p ?? null);
  }
  return paddlePromise;
}

export function usePaddleCheckout(userId: string | undefined) {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    getPaddle().then((p) => {
      if (!cancelled) setPaddle(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    activeEventHandler = (event: PaddleEvent) => {
      if (event.name === "checkout.completed") {
        toast.success("Payment received — activating your plan…");
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.credits(userId) });
        }, 4000);
      }
      if (event.name === "checkout.error") {
        toast.error("Checkout couldn't load — try again in a moment.");
      }
    };
    return () => {
      activeEventHandler = null;
    };
  }, [queryClient, userId]);

  const openCheckout = useCallback(
    (plan: Pick<PublicSubscriptionPlan, "paddle_price_id">, user: { id: string; email?: string }) => {
      if (!paddle || !plan.paddle_price_id) return;
      paddle.Checkout.open(buildCheckoutOptions(plan, user));
    },
    [paddle],
  );

  return { openCheckout, ready: !!paddle };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/hooks/use-paddle-checkout.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors. (If `Paddle["Checkout"]["open"]` doesn't resolve, check the installed
`@paddle/paddle-js` version's exported `Paddle` type shape — it's a public type export as
of the current major version.)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-paddle-checkout.ts src/hooks/use-paddle-checkout.test.ts
git commit -m "feat: add Paddle checkout hook with pure options builder"
```

---

### Task 4: Wire `PricingCard`, remove development-mode UI, flip the feature flag

**Files:**
- Modify: `src/components/pricing/pricing-card.tsx`
- Modify: `src/routes/_authenticated/_app/pricing.tsx`
- Modify: `src/config/features.ts`

**Interfaces:**
- Consumes: `usePaddleCheckout` (Task 3), `useAuth` (`src/hooks/use-auth.tsx`, existing).

- [ ] **Step 1: Flip the feature flag**

In `src/config/features.ts`, change:
```ts
  membershipPurchasing: {
    status: "development",
```
to:
```ts
  membershipPurchasing: {
    status: "available",
```

- [ ] **Step 2: Update `PricingCard`**

Replace the full contents of `src/components/pricing/pricing-card.tsx`:

```tsx
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  BILLING_INTERVAL_SUFFIX,
  formatPlanPrice,
  type PublicSubscriptionPlan,
} from "@/lib/subscription-plans";

export function PricingCard({
  plan,
  onChoosePlan,
  disabled,
}: {
  plan: PublicSubscriptionPlan;
  onChoosePlan?: () => void;
  disabled?: boolean;
}) {
  const price = formatPlanPrice(plan.price_amount, plan.currency);
  const interval = BILLING_INTERVAL_SUFFIX[plan.billing_interval];

  return (
    <li
      aria-label={plan.is_featured ? `${plan.title} — recommended plan` : plan.title}
      className={cn(
        "atelier-card relative flex flex-col p-6 sm:p-8",
        plan.is_featured &&
          "border-accent/70 shadow-atelier-soft ring-1 ring-accent/30 lg:-translate-y-2",
      )}
    >
      {plan.is_featured && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1.5 border border-accent/50 bg-accent-soft text-ink shadow-paper">
          <Sparkles aria-hidden="true" className="size-3" strokeWidth={1.75} />
          Recommended
        </Badge>
      )}

      <h2 className="font-serif text-2xl text-ink">{plan.title}</h2>
      {plan.description && (
        <p className="mt-2 text-sm leading-relaxed text-muted">{plan.description}</p>
      )}

      <p className="mt-6">
        <span className="font-display text-4xl font-bold tracking-tight text-ink tabular-nums">
          {price}
        </span>
        <span className="ml-2 text-xs uppercase tracking-[0.18em] text-muted">{interval}</span>
      </p>

      {(plan.credits_included > 0 || plan.features.length > 0) && (
        <ul className="mt-6 space-y-2.5 border-t border-line pt-6">
          {plan.credits_included > 0 && (
            <PlanFeature text={`${plan.credits_included} styling credits included`} />
          )}
          {plan.features.map((feature) => (
            <PlanFeature key={feature} text={feature} />
          ))}
        </ul>
      )}

      <div className="mt-auto pt-8">
        <Button
          type="button"
          onClick={onChoosePlan}
          disabled={disabled || !plan.paddle_price_id || !onChoosePlan}
          variant={plan.is_featured ? "primary" : "secondary"}
          className="w-full"
        >
          Choose Plan
        </Button>
      </div>
    </li>
  );
}

function PlanFeature({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-relaxed text-ink">
      <Check className="mt-1 size-3.5 shrink-0 text-accent" aria-hidden="true" strokeWidth={2} />
      <span className="min-w-0 wrap-break-words">{text}</span>
    </li>
  );
}
```

- [ ] **Step 3: Update `pricing.tsx`**

Replace the full contents of `src/routes/_authenticated/_app/pricing.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PricingCard } from "@/components/pricing/pricing-card";
import { publicSubscriptionPlansQueryOptions } from "@/lib/queries/subscription-plans";
import { useAuth } from "@/hooks/use-auth";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";

export const Route = createFileRoute("/_authenticated/_app/pricing")({
  component: PricingPage,
});

function PricingPage() {
  const { data, isLoading, isError, refetch } = useQuery(publicSubscriptionPlansQueryOptions());
  const { user } = useAuth();
  const { openCheckout, ready } = usePaddleCheckout(user?.id);

  return (
    <div className="atelier-page max-w-6xl">
      <header className="mb-10 text-center sm:mb-14">
        <p className="atelier-kicker mb-3">Membership</p>
        <h1 className="atelier-title">Choose Your Atelier Access</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted">
          Select the membership that best fits the way you want to style, explore, and create with
          Mila.
        </p>
      </header>

      {isLoading ? (
        <PricingSkeleton />
      ) : isError ? (
        <div role="alert" className="atelier-card mx-auto max-w-xl p-10 text-center sm:p-14">
          <p className="mb-2 font-serif text-2xl text-ink">Couldn't load membership plans</p>
          <p className="text-sm text-muted">
            Something went wrong on our side. Please try again in a moment.
          </p>
          <Button variant="secondary" className="mt-6" onClick={() => refetch()}>
            Try Again
          </Button>
        </div>
      ) : !data?.length ? (
        <EmptyState
          role="status"
          className="mx-auto max-w-xl"
          icon={<ScrollText className="size-8" strokeWidth={1.25} />}
          title="Membership plans are being prepared."
          description="Please check back soon."
        />
      ) : (
        <ul className="mx-auto grid max-w-5xl grid-cols-1 gap-6 pt-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {data.map((plan) => (
            <PricingCard
              key={plan.id}
              plan={plan}
              disabled={!ready}
              onChoosePlan={
                user ? () => openCheckout(plan, { id: user.id, email: user.email }) : undefined
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PricingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading membership plans"
      className="mx-auto grid max-w-5xl grid-cols-1 gap-6 pt-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8"
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="atelier-card h-100 animate-pulse bg-foreground/6" />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors. `DevelopmentBadge`/`DevelopmentNotice`/`FEATURES` imports are gone from
these two files — if either component is now unused anywhere else in the codebase, that's
fine, leave the component files themselves (other admin/dev-flagged features still use
`DevelopmentNotice`/`DevelopmentBadge` — check with `grep -rn "DevelopmentBadge\|DevelopmentNotice" src` before assuming they're dead; don't delete them, this task only stops using
them on the pricing page).

- [ ] **Step 5: Commit**

```bash
git add src/components/pricing/pricing-card.tsx src/routes/_authenticated/_app/pricing.tsx src/config/features.ts
git commit -m "feat: wire pricing page Choose Plan buttons to Paddle checkout"
```

---

### Task 5: CSP allowance for Paddle + browser verification

**Files:**
- Modify: `vite.config.ts:9-33` (`buildCsp`)

**Interfaces:** none (config only)

The current CSP has no allowance for Paddle at all. Paddle.js needs to load its script and
render a checkout iframe; the iframe's own internal network calls run under Paddle's own
CSP (not ours), so only `script-src` and `frame-src` are needed from our side.

- [ ] **Step 1: Add the CSP directives**

In `vite.config.ts`, update the `directives` object in `buildCsp`:

```ts
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
      "https://cdn.paddle.com",
    ],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "connect-src": [
      "'self'",
      ...(supabaseOrigin ? [supabaseOrigin] : []),
      "https://api.open-meteo.com",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
    ],
    "frame-src": [
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
      "https://buy.paddle.com",
      "https://sandbox-buy.paddle.com",
    ],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
```

- [ ] **Step 2: Verify in a real browser and fix any remaining CSP violations**

Run:
```bash
bun run dev > /tmp/dev-server.log 2>&1 &
sleep 4
```

Use the Playwright browser tools (`mcp__plugin_playwright_playwright__browser_navigate` to
`https://localhost:8080/pricing`, log in if needed, `browser_click` a "Choose Plan" button,
then `browser_console_messages`) to open the pricing page, click a plan, and inspect the
console for `Refused to ... because it violates the following Content Security Policy
directive` errors.

Expected: the checkout overlay renders with no CSP errors in the console. If a CSP error
names a domain not in Step 1's list (Paddle's checkout iframe or `paddle.js` script may load
a sub-resource — fonts, images, or an additional API host — from a domain not anticipated
here), add that exact domain to the relevant directive in `vite.config.ts` and re-run this
step. Repeat until no CSP violations appear when opening checkout.

Stop the dev server when done:
```bash
kill %1 2>/dev/null
```

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "feat: allow Paddle script/checkout iframe in CSP"
```

---

### Task 6: Manual sandbox checkout acceptance test

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run a full checkout with a sandbox test card**

```bash
bun run dev > /tmp/dev-server.log 2>&1 &
sleep 4
```

Navigate to `https://localhost:8080/pricing` (via Playwright or manually), sign in as a test
user, click "Choose Plan" on any plan, and complete checkout using a Paddle sandbox test
card: card number `4242 4242 4242 4242`, any future expiry, any 3-digit CVC.

- [ ] **Step 2: Confirm the toast and the credits badge update**

Expected: "Payment received — activating your plan…" toast appears immediately on
`checkout.completed`. Within a few seconds (webhook round-trip), the credits number next to
the `Coins` icon in the app shell nav (`src/components/layout/app-shell.tsx`) updates to the
plan's `credits_included` value — confirming the full loop: checkout → webhook (sub-project
#1) → `user_entitlements` sync → `queryKeys.credits` invalidation → UI.

- [ ] **Step 3: Confirm the subscription row landed**

Run:
```bash
set -a && source .env && set +a && node -e '
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
db.from("subscriptions").select("*").order("created_at", { ascending: false }).limit(1)
  .then(({ data, error }) => console.log(JSON.stringify({ data, error }, null, 2)));
'
```
Expected: one row with `status: "active"` (or `"trialing"`), the correct `plan_id`, and a
`paddle_customer_id` — this time with a real `user_id` populated (unlike sub-project #1's
Task 6 simulation, which had no `custom_data` and correctly produced no row).

- [ ] **Step 4: Stop the dev server**

```bash
kill %1 2>/dev/null
```

## Summary

| Task | Deliverable |
|---|---|
| 1 | `@paddle/paddle-js` installed, client token provisioned via API, env vars set |
| 2 | `paddle_price_id` exposed on the public plans query |
| 3 | `buildCheckoutOptions` (3 unit tests) + `usePaddleCheckout` hook |
| 4 | `PricingCard` + `pricing.tsx` wired to checkout, feature flag flipped, dev-mode UI removed |
| 5 | CSP allows Paddle's script + checkout iframe, verified with a real browser |
| 6 | Full sandbox checkout completed, credits badge and `subscriptions` row confirmed |
