# Paddle Webhook Receiver + Subscription Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror Paddle subscription state into Supabase via a signed webhook receiver, and drive `user_entitlements` (ads/credits) off that state.

**Architecture:** A raw TanStack Start API route (`POST /api/webhooks/paddle`) verifies the Paddle HMAC signature, then delegates to pure, dependency-injected logic in `src/lib/paddle-webhook.server.ts` that upserts a new `subscriptions` table and syncs `user_entitlements`. No new runtime dependencies — signature verification uses `node:crypto` directly.

**Tech Stack:** TanStack Start 1.168 (`createFileRoute(...).server.handlers`), Supabase (Postgres + `supabase-js`), `bun:test`.

## Global Constraints

- No webhook events audit/log table — the upsert is idempotent by final state (spec: "Out of scope").
- `past_due` counts as "in force" — no revocation during Paddle's dunning retries (spec: "Entitlement sync").
- Credit refill (`ai_credits = plan.credits_included`) fires only when `current_period_end` genuinely advances, or on first activation — never on every `subscription.updated` (spec: "Refill trigger").
- Revocation flips `ads_removed = false` only; `ai_credits` is never clawed back (spec: "Revoke").
- `custom_data.user_id`, set at checkout (a later sub-project), is the sole identity link — no email matching (spec: "Customer identity").
- Match existing repo conventions: `*.server.ts` for server-only dependency-injected logic (see `auth-handler.server.ts`), co-located `*.test.ts` using `bun:test` (see `auth.functions.test.ts`), FKs to `public.profiles(id)` rather than `auth.users(id)` for joinability (see `concierge_messages`).
- No new npm dependencies.

---

### Task 1: `subscriptions` table + `profiles.paddle_customer_id` migration

**Files:**
- Create: `supabase/migrations/<timestamp>_create_subscriptions.sql`

**Interfaces:**
- Produces: table `public.subscriptions(id, user_id, plan_id, paddle_subscription_id, paddle_customer_id, status, current_period_end, cancel_at_period_end, created_at, updated_at)`; column `public.profiles.paddle_customer_id`.

**Context:** `supabase migration list` shows the remote migration-history table is out of sync with reality — six local migrations (`20260713075119` through `20260724120000`) already ran against the live database (their tables/columns exist — verified directly via the service-role client) but aren't recorded as applied. Running `db push` as-is would try to replay all six `CREATE TABLE`s and fail. Repair the history first so `db push` only pushes what's actually new.

- [ ] **Step 1: Confirm the drift and repair the migration history**

Run:
```bash
npx --yes supabase migration list
```
Expected: the six migrations from `20260713075119` to `20260724120000` show an empty `remote` column.

Run:
```bash
npx --yes supabase migration repair --status applied \
  20260713075119 20260713120000 20260714090000 20260715120000 20260719120000 20260724120000
```
Expected: `Repaired migration history: ... applied`. This only edits the CLI's bookkeeping table — it does not touch schema.

Run:
```bash
npx --yes supabase db push --dry-run
```
Expected: `Would push these migrations:` with an empty list (nothing pending).

- [ ] **Step 2: Create the migration file via the CLI**

Run:
```bash
npx --yes supabase migration new create_subscriptions
```
Expected: creates `supabase/migrations/<timestamp>_create_subscriptions.sql` (an empty scaffold). Note the exact filename it prints — later steps refer to it as `<migration_file>`.

- [ ] **Step 3: Write the migration**

Replace the contents of `<migration_file>` with:

```sql
-- ============================================================================
-- subscriptions — mirrors Paddle subscription state into Supabase.
--
-- Populated exclusively by the Paddle webhook handler (service role); no
-- user-facing writes. user_id -> profiles (not auth.users), matching the
-- FK convention used by concierge_messages, so it's joinable from the
-- generated Supabase types.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN paddle_customer_id TEXT UNIQUE;

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  paddle_subscription_id TEXT NOT NULL UNIQUE,
  paddle_customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id, updated_at DESC);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Grants — service_role already has ALL via 20260710113000's default
-- privileges; authenticated users are read-only on their own rows.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.subscriptions FROM anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;

CREATE POLICY "Users view their own subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policies on purpose: every write goes through the
-- service role from the Paddle webhook handler
-- (src/lib/paddle-webhook.server.ts).
```

- [ ] **Step 4: Preview, then push**

Run:
```bash
npx --yes supabase db push --dry-run
```
Expected: `Would push these migrations:` listing only `<migration_file>`.

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
db.from("subscriptions").select("*").limit(1).then(({ error }) => {
  if (error) { console.error(error); process.exit(1); }
  console.log("subscriptions table OK");
});
db.from("profiles").select("paddle_customer_id").limit(1).then(({ error }) => {
  if (error) { console.error(error); process.exit(1); }
  console.log("profiles.paddle_customer_id OK");
});
'
```
Expected: both `... OK` lines print, no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add subscriptions table and profiles.paddle_customer_id"
```

---

### Task 2: Update generated Supabase types

**Files:**
- Modify: `src/integrations/supabase/types.ts:296` (insert `paddle_customer_id` into `profiles`)
- Modify: `src/integrations/supabase/types.ts:428` (insert new `subscriptions` entry after `subscription_plans`)

**Interfaces:**
- Consumes: schema from Task 1.
- Produces: `Database["public"]["Tables"]["subscriptions"]` and `Database["public"]["Tables"]["profiles"]["Row"].paddle_customer_id`, used by Task 4's `MilaSupabaseClient`.

This repo has no `supabase gen types` script (no Supabase CLI dependency wired into `package.json`) — prior additions (e.g. `paddle_product_id` on `subscription_plans`) were hand-edited to match the CLI's output format. Follow the same pattern.

- [ ] **Step 1: Add `paddle_customer_id` to `profiles`**

In `src/integrations/supabase/types.ts`, in the `profiles` block, add `paddle_customer_id: string | null;` (or `?:` for Insert/Update) immediately after the `id` field in all three of `Row`, `Insert`, and `Update`:

```ts
      profiles: {
        Row: {
          beauty_preferences: Json;
          body_type: string | null;
          color_profile: Json | null;
          color_season: string | null;
          created_at: string;
          default_location: string | null;
          face_shape: string | null;
          full_name: string | null;
          hair_type: string | null;
          id: string;
          paddle_customer_id: string | null;
          skin_undertone: string | null;
          suspended: boolean;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          beauty_preferences?: Json;
          body_type?: string | null;
          color_profile?: Json | null;
          color_season?: string | null;
          created_at?: string;
          default_location?: string | null;
          face_shape?: string | null;
          full_name?: string | null;
          hair_type?: string | null;
          id: string;
          paddle_customer_id?: string | null;
          skin_undertone?: string | null;
          suspended?: boolean;
          updated_at?: string;
          username?: string | null;
        };
        Update: {
          beauty_preferences?: Json;
          body_type?: string | null;
          color_profile?: Json | null;
          color_season?: string | null;
          created_at?: string;
          default_location?: string | null;
          face_shape?: string | null;
          full_name?: string | null;
          hair_type?: string | null;
          id?: string;
          paddle_customer_id?: string | null;
          skin_undertone?: string | null;
          suspended?: boolean;
          updated_at?: string;
          username?: string | null;
        };
        Relationships: [];
      };
```

- [ ] **Step 2: Insert the `subscriptions` table type**

Immediately after the `subscription_plans` block's closing `};` (right before the `support_messages: {` line), insert:

```ts
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_end: string | null;
          id: string;
          paddle_customer_id: string;
          paddle_subscription_id: string;
          plan_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          paddle_customer_id: string;
          paddle_subscription_id: string;
          plan_id: string;
          status: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          paddle_customer_id?: string;
          paddle_subscription_id?: string;
          plan_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "subscription_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
```

- [ ] **Step 3: Typecheck**

Run:
```bash
bun run typecheck
```
Expected: no new errors referencing `types.ts`, `profiles`, or `subscriptions`.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "feat: add subscriptions and profiles.paddle_customer_id to generated types"
```

---

### Task 3: Signature verification

**Files:**
- Create: `src/lib/paddle-webhook.server.ts`
- Test: `src/lib/paddle-webhook.server.test.ts`

**Interfaces:**
- Produces: `export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/paddle-webhook.server.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyPaddleSignature } from "./paddle-webhook.server";

const secret = "whsec_test_secret";

function signedHeader(body: string, ts: string, withSecret = secret): string {
  const h1 = createHmac("sha256", withSecret).update(`${ts}:${body}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

describe("verifyPaddleSignature", () => {
  test("accepts a correctly signed payload", () => {
    const body = JSON.stringify({ event_type: "subscription.created" });
    const header = signedHeader(body, "1700000000");
    expect(verifyPaddleSignature(body, header, secret)).toBe(true);
  });

  test("rejects a tampered body", () => {
    const body = JSON.stringify({ event_type: "subscription.created" });
    const header = signedHeader(body, "1700000000");
    expect(verifyPaddleSignature(body + "tampered", header, secret)).toBe(false);
  });

  test("rejects a signature made with the wrong secret", () => {
    const body = JSON.stringify({ event_type: "subscription.created" });
    const header = signedHeader(body, "1700000000", "whsec_other_secret");
    expect(verifyPaddleSignature(body, header, secret)).toBe(false);
  });

  test("rejects a missing header", () => {
    expect(verifyPaddleSignature("{}", null, secret)).toBe(false);
  });

  test("rejects a malformed header", () => {
    expect(verifyPaddleSignature("{}", "not-a-valid-header", secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/paddle-webhook.server.test.ts`
Expected: FAIL — `Cannot find module './paddle-webhook.server'` (file doesn't exist yet).

- [ ] **Step 3: Implement signature verification**

Create `src/lib/paddle-webhook.server.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function parseSignatureHeader(header: string): { ts?: string; h1?: string } {
  const parsed: Record<string, string> = {};
  for (const segment of header.split(";")) {
    const [key, value] = segment.split("=");
    if (key && value) parsed[key.trim()] = value.trim();
  }
  return parsed;
}

export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const { ts, h1 } = parseSignatureHeader(header);
  if (!ts || !h1) return false;

  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(h1, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/paddle-webhook.server.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/paddle-webhook.server.ts src/lib/paddle-webhook.server.test.ts
git commit -m "feat: add Paddle webhook signature verification"
```

---

### Task 4: Event application logic + entitlement sync

**Files:**
- Modify: `src/lib/paddle-webhook.server.ts` (append to the file from Task 3)
- Test: `src/lib/paddle-webhook.server.test.ts` (append to the file from Task 3)

**Interfaces:**
- Consumes: `verifyPaddleSignature` (Task 3, same file, unaffected).
- Produces:
  - `export type PaddleSubscriptionWebhookEvent = { event_type: "subscription.created" | "subscription.updated" | "subscription.canceled"; data: { id: string; customer_id: string; status: string; current_billing_period: { ends_at: string } | null; scheduled_change: { action: string } | null; items: Array<{ price: { id: string } }>; custom_data: { user_id?: string } | null; }; }`
  - `export async function applyPaddleSubscriptionEvent(db: SupabaseClient<Database>, event: PaddleSubscriptionWebhookEvent): Promise<void>` — used by Task 5's route handler.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/paddle-webhook.server.test.ts`:

```ts
import { mock } from "bun:test";
import { applyPaddleSubscriptionEvent, type PaddleSubscriptionWebhookEvent } from "./paddle-webhook.server";

type Terminal = { data: unknown; error: unknown };

function fakeChain(terminal: Terminal, onWrite?: (payload: unknown) => void) {
  const chain = {
    select: (..._args: unknown[]) => chain,
    eq: (..._args: unknown[]) => chain,
    is: (..._args: unknown[]) => chain,
    update: (payload: unknown) => {
      onWrite?.(payload);
      return chain;
    },
    upsert: (payload: unknown) => {
      onWrite?.(payload);
      return chain;
    },
    maybeSingle: async () => terminal,
    then: (resolve: (v: Terminal) => void) => resolve(terminal),
  };
  return chain;
}

function fakeDb(config: {
  plan: Terminal;
  existingSubscription?: Terminal;
}) {
  const subscriptionUpserts: unknown[] = [];
  const profileUpdates: unknown[] = [];
  const entitlementUpdates: unknown[] = [];
  let subscriptionsCallCount = 0;

  const from = mock((table: string) => {
    if (table === "subscription_plans") return fakeChain(config.plan);
    if (table === "subscriptions") {
      subscriptionsCallCount += 1;
      if (subscriptionsCallCount === 1) {
        return fakeChain(config.existingSubscription ?? { data: null, error: null });
      }
      return fakeChain({ data: null, error: null }, (p) => subscriptionUpserts.push(p));
    }
    if (table === "profiles") {
      return fakeChain({ data: null, error: null }, (p) => profileUpdates.push(p));
    }
    if (table === "user_entitlements") {
      return fakeChain({ data: null, error: null }, (p) => entitlementUpdates.push(p));
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { db: { from } as never, subscriptionUpserts, profileUpdates, entitlementUpdates };
}

function baseEvent(overrides: Partial<PaddleSubscriptionWebhookEvent["data"]>): PaddleSubscriptionWebhookEvent {
  return {
    event_type: "subscription.created",
    data: {
      id: "sub_123",
      customer_id: "ctm_123",
      status: "active",
      current_billing_period: { ends_at: "2026-08-24T00:00:00Z" },
      scheduled_change: null,
      items: [{ price: { id: "pri_starter" } }],
      custom_data: { user_id: "user-1" },
      ...overrides,
    },
  };
}

describe("applyPaddleSubscriptionEvent", () => {
  test("grants entitlements and sets initial credits for a new active subscription", async () => {
    const { db, subscriptionUpserts, entitlementUpdates } = fakeDb({
      plan: { data: { id: "plan-1", credits_included: 500 }, error: null },
      existingSubscription: { data: null, error: null },
    });
    await applyPaddleSubscriptionEvent(db, baseEvent({}));

    expect(subscriptionUpserts).toEqual([
      {
        user_id: "user-1",
        plan_id: "plan-1",
        paddle_subscription_id: "sub_123",
        paddle_customer_id: "ctm_123",
        status: "active",
        current_period_end: "2026-08-24T00:00:00Z",
        cancel_at_period_end: false,
      },
    ]);
    expect(entitlementUpdates).toEqual([{ ads_removed: true, ai_credits: 500 }]);
  });

  test("refills credits only when the billing period actually advances", async () => {
    const { db, entitlementUpdates } = fakeDb({
      plan: { data: { id: "plan-1", credits_included: 500 }, error: null },
      existingSubscription: { data: { current_period_end: "2026-07-24T00:00:00Z" }, error: null },
    });
    await applyPaddleSubscriptionEvent(
      db,
      baseEvent({ current_billing_period: { ends_at: "2026-07-24T00:00:00Z" } }),
    );

    expect(entitlementUpdates).toEqual([{ ads_removed: true }]);
  });

  test("revokes ads_removed without clawing back credits on cancellation", async () => {
    const { db, entitlementUpdates } = fakeDb({
      plan: { data: { id: "plan-1", credits_included: 500 }, error: null },
      existingSubscription: { data: { current_period_end: "2026-08-24T00:00:00Z" }, error: null },
    });
    await applyPaddleSubscriptionEvent(
      db,
      baseEvent({ status: "canceled", current_billing_period: null }),
    );

    expect(entitlementUpdates).toEqual([{ ads_removed: false }]);
  });

  test("keeps access during past_due (dunning grace period)", async () => {
    const { db, entitlementUpdates } = fakeDb({
      plan: { data: { id: "plan-1", credits_included: 500 }, error: null },
      existingSubscription: { data: { current_period_end: "2026-08-24T00:00:00Z" }, error: null },
    });
    await applyPaddleSubscriptionEvent(
      db,
      baseEvent({ status: "past_due", current_billing_period: { ends_at: "2026-08-24T00:00:00Z" } }),
    );

    expect(entitlementUpdates).toEqual([{ ads_removed: true }]);
  });

  test("skips processing when custom_data.user_id is missing", async () => {
    const { db, subscriptionUpserts, entitlementUpdates } = fakeDb({
      plan: { data: { id: "plan-1", credits_included: 500 }, error: null },
    });
    await applyPaddleSubscriptionEvent(db, baseEvent({ custom_data: null }));

    expect(subscriptionUpserts).toEqual([]);
    expect(entitlementUpdates).toEqual([]);
  });

  test("skips processing when the price id doesn't match a known plan", async () => {
    const { db, subscriptionUpserts, entitlementUpdates } = fakeDb({
      plan: { data: null, error: null },
    });
    await applyPaddleSubscriptionEvent(db, baseEvent({}));

    expect(subscriptionUpserts).toEqual([]);
    expect(entitlementUpdates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/paddle-webhook.server.test.ts`
Expected: FAIL — `applyPaddleSubscriptionEvent is not exported` (or similar).

- [ ] **Step 3: Implement event application logic**

Append to `src/lib/paddle-webhook.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type MilaSupabaseClient = SupabaseClient<Database>;

export type PaddleSubscriptionWebhookEvent = {
  event_type: "subscription.created" | "subscription.updated" | "subscription.canceled";
  data: {
    id: string;
    customer_id: string;
    status: string;
    current_billing_period: { ends_at: string } | null;
    scheduled_change: { action: string } | null;
    items: Array<{ price: { id: string } }>;
    custom_data: { user_id?: string } | null;
  };
};

const IN_FORCE_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function applyPaddleSubscriptionEvent(
  db: MilaSupabaseClient,
  event: PaddleSubscriptionWebhookEvent,
): Promise<void> {
  const { data } = event;
  const userId = data.custom_data?.user_id;
  if (!userId) {
    console.error("[paddle-webhook] missing custom_data.user_id", { subscriptionId: data.id });
    return;
  }

  const priceId = data.items[0]?.price.id;
  const { data: plan, error: planError } = await db
    .from("subscription_plans")
    .select("id, credits_included")
    .eq("paddle_price_id", priceId ?? "")
    .maybeSingle();
  if (planError || !plan) {
    console.error("[paddle-webhook] unknown paddle price id", { priceId, subscriptionId: data.id });
    return;
  }

  const { data: existing } = await db
    .from("subscriptions")
    .select("current_period_end")
    .eq("paddle_subscription_id", data.id)
    .maybeSingle();

  const newPeriodEnd = data.current_billing_period?.ends_at ?? null;
  const isRenewal =
    newPeriodEnd !== null &&
    (existing?.current_period_end == null ||
      new Date(newPeriodEnd).getTime() > new Date(existing.current_period_end).getTime());

  const { error: upsertError } = await db.from("subscriptions").upsert(
    {
      user_id: userId,
      plan_id: plan.id,
      paddle_subscription_id: data.id,
      paddle_customer_id: data.customer_id,
      status: data.status,
      current_period_end: newPeriodEnd,
      cancel_at_period_end: data.scheduled_change?.action === "cancel",
    },
    { onConflict: "paddle_subscription_id" },
  );
  if (upsertError) {
    console.error("[paddle-webhook] failed to upsert subscription", upsertError);
    return;
  }

  await db
    .from("profiles")
    .update({ paddle_customer_id: data.customer_id })
    .eq("id", userId)
    .is("paddle_customer_id", null);

  const inForce = IN_FORCE_STATUSES.has(data.status);
  const entitlementUpdate: { ads_removed: boolean; ai_credits?: number } = {
    ads_removed: inForce,
  };
  if (inForce && isRenewal) entitlementUpdate.ai_credits = plan.credits_included;

  const { error: entitlementError } = await db
    .from("user_entitlements")
    .update(entitlementUpdate)
    .eq("user_id", userId);
  if (entitlementError) {
    console.error("[paddle-webhook] failed to sync entitlements", entitlementError);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/paddle-webhook.server.test.ts`
Expected: PASS — 11 tests total (5 from Task 3 + 6 from this task).

- [ ] **Step 5: Commit**

```bash
git add src/lib/paddle-webhook.server.ts src/lib/paddle-webhook.server.test.ts
git commit -m "feat: sync Paddle subscription events into subscriptions and user_entitlements"
```

---

### Task 5: Webhook route + env wiring

**Files:**
- Create: `src/routes/api/webhooks/paddle.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `verifyPaddleSignature`, `applyPaddleSubscriptionEvent`, `PaddleSubscriptionWebhookEvent` (Task 3 & 4); `requireEnv` (`src/lib/env.ts`); `supabaseAdmin` (`src/integrations/supabase/client.server.ts`).
- Produces: `POST /api/webhooks/paddle` HTTP endpoint.

- [ ] **Step 1: Add the env var placeholder**

In `.env.example`, add:

```
# Paddle sandbox notification destination secret (Task 5, docs/superpowers/plans/2026-07-24-paddle-webhook-subscription-sync.md).
# Created when registering the webhook URL under Paddle > Developer tools > Notifications.
PADDLE_SANDBOX_WEBHOOK_SECRET=
```

- [ ] **Step 2: Write the route**

Create `src/routes/api/webhooks/paddle.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { requireEnv } from "@/lib/env";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  applyPaddleSubscriptionEvent,
  verifyPaddleSignature,
  type PaddleSubscriptionWebhookEvent,
} from "@/lib/paddle-webhook.server";

const HANDLED_EVENT_TYPES = new Set(["subscription.created", "subscription.updated", "subscription.canceled"]);

export const Route = createFileRoute("/api/webhooks/paddle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { PADDLE_SANDBOX_WEBHOOK_SECRET } = requireEnv({
          PADDLE_SANDBOX_WEBHOOK_SECRET: process.env.PADDLE_SANDBOX_WEBHOOK_SECRET,
        });

        const rawBody = await request.text();
        const signature = request.headers.get("Paddle-Signature");
        if (!verifyPaddleSignature(rawBody, signature, PADDLE_SANDBOX_WEBHOOK_SECRET)) {
          return new Response("Invalid signature", { status: 401 });
        }

        const event = JSON.parse(rawBody) as PaddleSubscriptionWebhookEvent;
        if (HANDLED_EVENT_TYPES.has(event.event_type)) {
          await applyPaddleSubscriptionEvent(supabaseAdmin, event);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
```

- [ ] **Step 3: Typecheck and confirm the route registers**

Run:
```bash
bun run typecheck
```
Expected: no errors on the new route file. (`src/routeTree.gen.ts` is auto-generated by the TanStack Router Vite plugin on next dev/build — no manual edit needed.)

Run (the dev server uses `vite-plugin-mkcert`, so it serves HTTPS on port 8080 — see `vite.config.ts:57`; `-k` skips local cert verification):
```bash
bun run dev &
sleep 3
curl -sk -o /dev/null -w "%{http_code}\n" -X POST https://localhost:8080/api/webhooks/paddle -d '{}'
kill %1
```
Expected: `401` (missing/invalid signature — proves the route is wired and the env var is being read; confirms this *before* a real secret is configured). If it prints `500` with `Missing environment variable(s): PADDLE_SANDBOX_WEBHOOK_SECRET...`, add a placeholder value to your local `.env` and rerun.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/webhooks/paddle.ts .env.example
git commit -m "feat: add POST /api/webhooks/paddle route"
```

---

### Task 6: Manual sandbox acceptance test

**Files:** none (verification only — no code changes)

**Interfaces:** none

This is the "does it actually work end-to-end" check the design doc calls for — it needs a real Paddle sandbox subscription event hitting a publicly reachable URL, which the unit tests in Tasks 3–4 can't exercise.

- [ ] **Step 1: Start a local tunnel**

Run (any tunnel tool works; example uses `cloudflared`, no account needed for a quick tunnel; the dev server is HTTPS on port 8080 per `vite.config.ts:57`):
```bash
bun run dev &
cloudflared tunnel --url https://localhost:8080
```
Note the printed `https://<random>.trycloudflare.com` URL.

- [ ] **Step 2: Register the notification destination in Paddle sandbox**

Paddle sandbox dashboard → **Developer tools → Notifications** → **New destination**:
- URL: `https://<tunnel-url>/api/webhooks/paddle`
- Events: `subscription.created`, `subscription.updated`, `subscription.canceled`

Copy the generated secret into your local `.env` as `PADDLE_SANDBOX_WEBHOOK_SECRET`, then restart `bun run dev` so it picks up the new value.

- [ ] **Step 3: Fire a test event via the simulator**

In the same Notifications page, open the new destination and use **Send test event** for `subscription.created`.

- [ ] **Step 4: Confirm it landed**

Run:
```bash
set -a && source .env && set +a && node -e '
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
db.from("subscriptions").select("*").order("created_at", { ascending: false }).limit(1)
  .then(({ data, error }) => console.log(JSON.stringify({ data, error }, null, 2)));
'
```
Expected: the simulator's test subscription appears. (The simulator sends placeholder `custom_data`, so this may log a `[paddle-webhook] missing custom_data.user_id` and return `200` with no row inserted — that in itself confirms the route, signature check, and error-handling path all work; a full end-to-end row only appears once real checkout traffic — sub-project #2 — sets `custom_data.user_id`.)

- [ ] **Step 5: Stop the tunnel and dev server**

```bash
kill %1 %2 2>/dev/null
```

---

## Summary

| Task | Deliverable |
|---|---|
| 1 | `subscriptions` table + `profiles.paddle_customer_id`, migration history repaired and pushed |
| 2 | Generated types updated to match |
| 3 | `verifyPaddleSignature` — signed/tampered/wrong-secret/missing/malformed, 5 tests |
| 4 | `applyPaddleSubscriptionEvent` — renewal detection, grace period, revoke-without-clawback, missing identity, unknown plan, 6 tests |
| 5 | `POST /api/webhooks/paddle` wired to both, `.env.example` documented |
| 6 | Manual sandbox round-trip via tunnel + notification simulator |
