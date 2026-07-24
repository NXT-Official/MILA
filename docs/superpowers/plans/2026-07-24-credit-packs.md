# Credit Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a subscriber who has run out of today's daily AI credits buy a one-time top-up ("credit pack") on the spot, so they can keep using Mila the same day.

**Architecture:** Mirrors the existing `subscription_plans` machinery end to end: an admin-managed Postgres catalog table (`credit_packs`), a Paddle one-time checkout triggered from the existing paywall dialog, and a `transaction.completed` webhook handler that grants credits via a new `grant_ai_credits` RPC — idempotent via a `credit_pack_purchases` ledger table keyed on Paddle's transaction id.

**Tech Stack:** TanStack Start server functions, Supabase/Postgres (RLS + `SECURITY DEFINER` RPCs), Paddle.js checkout + webhooks, React Query, react-hook-form + zod, bun:test.

## Global Constraints

- Money is always an integer in the currency's smallest unit (cents for usd) — never floats. (from `subscription_plans` convention, reused here)
- All catalog writes (`credit_packs`) go through `assertAdmin`-gated server functions using the service-role client — no authenticated-role INSERT/UPDATE/DELETE policies.
- `paddle_product_id`/`paddle_price_id` are populated directly in the database after creating the matching product/price in the Paddle dashboard — **never** exposed as an editable field in the admin form (same rule `subscription_plans` already follows, see `supabase/migrations/20260724120000_add_paddle_ids_to_subscription_plans.sql`).
- No "Mila Unlimited" tier, no rollover of purchased credits to the next day, no refund/chargeback clawback — all explicitly out of scope per the spec.
- Test runner is `bun test`; typecheck is `bun run typecheck`; lint is `bun run lint`.

---

### Task 1: Migration — `credit_packs` catalog table

**Files:**
- Create: `supabase/migrations/20260724150000_create_credit_packs.sql`

**Interfaces:**
- Produces: table `public.credit_packs` with columns `id, slug, title, description, price_amount, currency, credits, is_active, sort_order, paddle_product_id, paddle_price_id, archived_at, created_at, updated_at`. Consumed by Tasks 4, 5, 6, 7.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- credit_packs — dynamic, admin-managed one-time credit top-up catalog.
--
-- Same conventions as subscription_plans (20260713120000):
--   * money as integer smallest-unit (cents for usd)
--   * updated_at via public.update_updated_at_column()
--   * RLS with (select ...) initplan pattern, explicit TO authenticated
--   * writes are service-role only (assertAdmin in credit-packs.functions.ts)
--   * paddle_product_id/paddle_price_id populated directly in the database
--     after creating the matching product/price in Paddle — never set by
--     the admin pack form (see 20260724120000_add_paddle_ids_to_subscription_plans.sql)
--
-- No "featured" or "billing_interval" concept — these are one-time top-ups,
-- not membership tiers. No "Mila Unlimited"-style tier either (dropped during
-- design: doesn't fit a balance that resets daily to a plan allowance).
-- ============================================================================

CREATE TABLE public.credit_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 60),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 280),
  price_amount INTEGER NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  credits INTEGER NOT NULL CHECK (credits > 0),
  is_active BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  paddle_product_id TEXT,
  paddle_price_id TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_packs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_credit_packs_active_sort
  ON public.credit_packs (is_active, sort_order);

-- Lookup direction used by the webhook: Paddle price -> local pack.
CREATE UNIQUE INDEX credit_packs_paddle_price_id_idx
  ON public.credit_packs (paddle_price_id)
  WHERE paddle_price_id IS NOT NULL;

CREATE TRIGGER update_credit_packs_updated_at
  BEFORE UPDATE ON public.credit_packs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON public.credit_packs FROM anon, authenticated;
GRANT SELECT ON public.credit_packs TO authenticated;

CREATE POLICY "Authenticated view active credit packs" ON public.credit_packs
  FOR SELECT TO authenticated
  USING (is_active AND archived_at IS NULL);

CREATE POLICY "Admins view all credit packs" ON public.credit_packs
  FOR SELECT TO authenticated
  USING ((select public.has_role(auth.uid(), 'admin')));
```

- [ ] **Step 2: Apply the migration locally and verify the table exists**

Run: `supabase migration up` (or your project's usual local-migration command — check `supabase/config.toml` / existing scripts if `supabase` CLI isn't linked yet)
Expected: no errors; `\d public.credit_packs` in `psql` (or the Supabase Studio table view) shows all 13 columns and the two indexes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260724150000_create_credit_packs.sql
git commit -m "feat: add credit_packs catalog table"
```

---

### Task 2: Migration — `credit_pack_purchases` ledger + `grant_ai_credits` RPC

**Files:**
- Create: `supabase/migrations/20260724160000_create_credit_pack_purchases.sql`

**Interfaces:**
- Consumes: `public.credit_packs(id)` from Task 1; `public.user_entitlements(ai_credits, credits_reset_at)` from the existing `20260724140000_add_credit_reset.sql`.
- Produces: table `public.credit_pack_purchases`; RPC `grant_ai_credits(_user_id UUID, _daily_allowance INTEGER, _amount INTEGER) RETURNS INTEGER`. Consumed by Task 3.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- credit_pack_purchases — idempotency ledger for one-time credit-pack
-- purchases, plus grant_ai_credits() to add purchased credits on top of a
-- user's current balance.
--
-- paddle_transaction_id is UNIQUE: Paddle can retry webhook delivery for the
-- same transaction. The webhook handler upserts with
-- { onConflict: "paddle_transaction_id", ignoreDuplicates: true }, so a
-- retried delivery is a no-op insert (no error, no second grant) rather than
-- needing an application-level dedup cache.
--
-- No client access at all: this table is the webhook's internal bookkeeping,
-- written only by the service role. Not surfaced in any admin UI in this
-- change — out of scope per the design spec.
-- ============================================================================

CREATE TABLE public.credit_pack_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credit_pack_id UUID NOT NULL REFERENCES public.credit_packs(id),
  paddle_transaction_id TEXT NOT NULL UNIQUE,
  credits_granted INTEGER NOT NULL CHECK (credits_granted > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_pack_purchases ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_credit_pack_purchases_user ON public.credit_pack_purchases (user_id);

REVOKE ALL ON public.credit_pack_purchases FROM anon, authenticated;

-- Mirrors consume_ai_credit's row-lock and day-reset logic exactly, so a
-- purchase made before the user's first credit-consuming action of the day
-- doesn't stack on top of a stale (yesterday's) balance.
CREATE FUNCTION public.grant_ai_credits(
  _user_id UUID,
  _daily_allowance INTEGER,
  _amount INTEGER
)
RETURNS INTEGER
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
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

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

  UPDATE public.user_entitlements
  SET ai_credits = _post_reset_credits + _amount, credits_reset_at = _today
  WHERE user_id = _user_id
  RETURNING ai_credits INTO _final_credits;

  RETURN _final_credits;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_ai_credits(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_ai_credits(UUID, INTEGER, INTEGER) TO service_role;
```

- [ ] **Step 2: Apply the migration and verify the RPC manually**

Run: `supabase migration up`
Then, against a test user row in `user_entitlements` (e.g. via Supabase Studio SQL editor):

```sql
-- seed: ai_credits = 0, credits_reset_at = CURRENT_DATE (already reset today)
select public.grant_ai_credits('<test-user-id>', 5, 10); -- expect 10 (0 + 10)

-- seed: credits_reset_at = CURRENT_DATE - 1 (stale)
select public.grant_ai_credits('<test-user-id>', 5, 10); -- expect 15 (reset to 5, then +10)
```

Expected: first call returns `10`, second call (after manually setting `credits_reset_at` back one day) returns `15`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260724160000_create_credit_pack_purchases.sql
git commit -m "feat: add credit_pack_purchases ledger and grant_ai_credits RPC"
```

---

### Task 3: `grantAiCredits` in `credits.server.ts`

**Files:**
- Modify: `src/lib/credits.server.ts`
- Modify: `tests/helpers/memory-credit-store.ts`
- Modify: `src/lib/credits.server.test.ts`

**Interfaces:**
- Consumes: `resolveDailyCreditAllowance` (already defined in this file, unexported, used internally — no export needed since `grantAiCredits` lives in the same file).
- Produces: `export type GrantCreditStore = (userId: string, dailyAllowance: number, amount: number) => Promise<number>`; `export async function grantAiCredits(supabase: SupabaseClient, userId: string, amount: number, store: GrantCreditStore = supabaseGrantCreditStore): Promise<number>`. Consumed by Task 7.

- [ ] **Step 1: Add a `grant` method to the shared in-memory test double**

`tests/helpers/memory-credit-store.ts` currently only exposes `consume`. Add a `grant` method that shares the same internal map, so tests can exercise "grant credits" against the same fake state `consume` uses:

```ts
import type { ConsumeCreditStore, GrantCreditStore } from "../../src/lib/credits.server";

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

  grant: GrantCreditStore = async (userId, dailyAllowance, amount) => {
    const today = this.today();
    const existing = this.entitlements.get(userId) ?? { credits: dailyAllowance, resetAt: "" };
    const credits = existing.resetAt === today ? existing.credits : dailyAllowance;
    const remaining = credits + amount;
    this.entitlements.set(userId, { credits: remaining, resetAt: today });
    return remaining;
  };
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/credits.server.test.ts` (add `grantAiCredits` to the existing import on line 2):

```ts
import { consumeAiCredit, grantAiCredits } from "./credits.server";
```

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/lib/credits.server.test.ts`
Expected: FAIL — `grantAiCredits is not a function` / `store.grant is not a function`.

- [ ] **Step 4: Implement `grantAiCredits`**

Append to `src/lib/credits.server.ts` (after the existing `consumeAiCredit` function, end of file):

```ts
export type GrantCreditStore = (
  userId: string,
  dailyAllowance: number,
  amount: number,
) => Promise<number>;

async function supabaseGrantCreditStore(
  userId: string,
  dailyAllowance: number,
  amount: number,
): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("grant_ai_credits", {
    _user_id: userId,
    _daily_allowance: dailyAllowance,
    _amount: amount,
  });
  if (error) throw error;
  return data as number;
}

export async function grantAiCredits(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  store: GrantCreditStore = supabaseGrantCreditStore,
): Promise<number> {
  const dailyAllowance = await resolveDailyCreditAllowance(supabase, userId);
  return store(userId, dailyAllowance, amount);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/lib/credits.server.test.ts`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/lib/credits.server.ts tests/helpers/memory-credit-store.ts src/lib/credits.server.test.ts
git commit -m "feat: add grantAiCredits for one-time credit pack top-ups"
```

---

### Task 4: `src/lib/credit-packs.ts` — types and admin-input schemas

**Files:**
- Create: `src/lib/credit-packs.ts`

**Interfaces:**
- Consumes: `planSlugSchema`, `slugifyPlanTitle`, `formatPlanPrice`, `parsePriceToCents`, `centsToPriceInput` from `@/lib/subscription-plans` (pure formatting/validation helpers, reused as-is rather than duplicated — their behavior isn't plan-specific).
- Produces: `interface CreditPack`, `type PublicCreditPack`, `const PUBLIC_PACK_COLUMNS`, `createCreditPackInputSchema`, `type CreateCreditPackInput`, `updateCreditPackInputSchema`, `type UpdateCreditPackInput`. Consumed by Tasks 5, 6, 9, 10.

- [ ] **Step 1: Write the file**

```ts
import { z } from "zod";
import { planSlugSchema } from "@/lib/subscription-plans";

export interface CreditPack {
  id: string;
  slug: string;
  title: string;
  description: string;
  price_amount: number;
  currency: string;
  credits: number;
  is_active: boolean;
  sort_order: number;
  paddle_product_id: string | null;
  paddle_price_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicCreditPack = Pick<
  CreditPack,
  | "id"
  | "slug"
  | "title"
  | "description"
  | "price_amount"
  | "currency"
  | "credits"
  | "paddle_price_id"
>;

export const PUBLIC_PACK_COLUMNS =
  "id,slug,title,description,price_amount,currency,credits,paddle_price_id";

export const createCreditPackInputSchema = z.object({
  slug: planSlugSchema,
  title: z.string().trim().min(1, "Title is required.").max(80),
  description: z.string().trim().max(280).default(""),
  price_amount: z.number().int().min(0).max(100_000_000),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, "Use a 3-letter currency code, e.g. usd."),
  credits: z.number().int().min(1).max(1_000_000),
  is_active: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(9999).default(0),
});
export type CreateCreditPackInput = z.infer<typeof createCreditPackInputSchema>;

export const updateCreditPackInputSchema = createCreditPackInputSchema.partial().extend({
  id: z.string().uuid(),
});
export type UpdateCreditPackInput = z.infer<typeof updateCreditPackInputSchema>;
```

There is no dedicated test file for this — it's the same kind of pure types-and-schema module as `subscription-plans.ts`, which also has none; its zod rules get exercised indirectly through Task 5's server functions and Task 9's form.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no new errors (this file has no consumers yet, so it should compile standalone).

- [ ] **Step 3: Commit**

```bash
git add src/lib/credit-packs.ts
git commit -m "feat: add credit pack types and admin input schemas"
```

---

### Task 5: `src/lib/credit-packs.functions.ts` — admin CRUD server functions

**Files:**
- Create: `src/lib/credit-packs.functions.ts`

**Interfaces:**
- Consumes: `assertAdmin`, `recordStaffAction` from `@/lib/admin.functions`; `createCreditPackInputSchema`, `updateCreditPackInputSchema`, `type CreditPack` from `@/lib/credit-packs` (Task 4); table `public.credit_packs` (Task 1).
- Produces: `adminListCreditPacks`, `adminCreateCreditPack`, `adminUpdateCreditPack`, `adminSetCreditPackArchived`, `adminDeleteCreditPack` (all `createServerFn` instances). Consumed by Tasks 6, 9.

- [ ] **Step 1: Write the file**

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, recordStaffAction } from "@/lib/admin.functions";
import {
  createCreditPackInputSchema,
  updateCreditPackInputSchema,
  type CreditPack,
} from "@/lib/credit-packs";

function throwPackError(error: { code?: string; message: string }, fallback: string): never {
  console.error("[credit-packs]", error);
  if (error.code === "23505") throw new Error("A credit pack with this slug already exists.");
  if (error.code === "23514") throw new Error("A field value is invalid.");
  if (error.code === "23503")
    throw new Error("This pack is referenced by past purchases — archive it instead.");
  throw new Error(fallback);
}

async function getAdminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const adminListCreditPacks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CreditPack[]> => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { data, error } = await db
      .from("credit_packs")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throwPackError(error, "Couldn't load credit packs.");
    return (data ?? []) as CreditPack[];
  });

export const adminCreateCreditPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createCreditPackInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { data: created, error } = await db
      .from("credit_packs")
      .insert(data)
      .select("id")
      .single();
    if (error) throwPackError(error, "Couldn't create the pack.");
    await recordStaffAction(context.userId, "credit_pack.created", "credit_pack", created.id, {
      slug: data.slug,
      title: data.title,
      is_active: data.is_active,
    });
    return { ok: true };
  });

export const adminUpdateCreditPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => updateCreditPackInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...fields } = data;
    if (Object.keys(fields).length === 0) return { ok: true };
    const db = await getAdminDb();
    const { error } = await db.from("credit_packs").update(fields).eq("id", id);
    if (error) throwPackError(error, "Couldn't update the pack.");
    await recordStaffAction(context.userId, "credit_pack.updated", "credit_pack", id, {
      changed_fields: Object.keys(fields),
    });
    return { ok: true };
  });

const SetArchivedInput = z.object({
  id: z.string().uuid(),
  archived: z.boolean(),
});

export const adminSetCreditPackArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SetArchivedInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { error } = await db
      .from("credit_packs")
      .update(
        data.archived
          ? { archived_at: new Date().toISOString(), is_active: false }
          : { archived_at: null },
      )
      .eq("id", data.id);
    if (error) throwPackError(error, "Couldn't update the pack.");
    await recordStaffAction(
      context.userId,
      data.archived ? "credit_pack.retired" : "credit_pack.restored",
      "credit_pack",
      data.id,
    );
    return { ok: true };
  });

const DeletePackInput = z.object({ id: z.string().uuid() });

export const adminDeleteCreditPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => DeletePackInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { error } = await db.from("credit_packs").delete().eq("id", data.id);
    if (error) throwPackError(error, "Couldn't delete the pack.");
    await recordStaffAction(context.userId, "credit_pack.deleted", "credit_pack", data.id);
    return { ok: true };
  });
```

There's no `*.functions.test.ts` for `subscription-plans.functions.ts` in this codebase either (it's exercised through the admin UI + manual QA, same as `subscriptions.functions.ts` which *does* have a test only because it wraps non-trivial Paddle-API branching logic — this file is straight CRUD with no branching worth isolating). Skipped for the same reason; covered by Task 9's manual QA pass.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/credit-packs.functions.ts
git commit -m "feat: add admin CRUD server functions for credit packs"
```

---

### Task 6: Query options + query keys

**Files:**
- Create: `src/lib/queries/credit-packs.ts`
- Modify: `src/constants/query-keys.ts`

**Interfaces:**
- Consumes: `adminListCreditPacks` (Task 5), `PUBLIC_PACK_COLUMNS`, `type PublicCreditPack` (Task 4).
- Produces: `adminCreditPacksQueryOptions()`, `publicCreditPacksQueryOptions()`; `queryKeys.adminCreditPacks`, `queryKeys.creditPacks`. Consumed by Tasks 9, 10.

- [ ] **Step 1: Add the two new query keys**

In `src/constants/query-keys.ts`, add two entries (after `subscriptionPlans`):

```ts
  adminCreditPacks: ["admin:credit-packs"] as const,
  creditPacks: ["credit-packs"] as const,
```

- [ ] **Step 2: Write the query options file**

```ts
import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { adminListCreditPacks } from "@/lib/credit-packs.functions";
import { PUBLIC_PACK_COLUMNS, type PublicCreditPack } from "@/lib/credit-packs";

export function adminCreditPacksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.adminCreditPacks,
    queryFn: () => adminListCreditPacks(),
  });
}

export function publicCreditPacksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.creditPacks,
    queryFn: async (): Promise<PublicCreditPack[]> => {
      const { data, error } = await supabase
        .from("credit_packs")
        .select(PUBLIC_PACK_COLUMNS)
        .eq("is_active", true)
        .is("archived_at", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error("Couldn't load credit packs.");
      return (data ?? []) as PublicCreditPack[];
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/credit-packs.ts src/constants/query-keys.ts
git commit -m "feat: add credit pack query options"
```

---

### Task 7: Webhook handling — `applyPaddleCreditPackEvent`

**Files:**
- Modify: `src/lib/paddle-webhook.server.ts`
- Modify: `src/lib/paddle-webhook.server.test.ts`

**Interfaces:**
- Consumes: `grantAiCredits` from `@/lib/credits.server` (Task 3); tables `credit_packs`, `credit_pack_purchases` (Tasks 1, 2).
- Produces: `type PaddleTransactionWebhookEvent`; `async function applyPaddleCreditPackEvent(db: MilaSupabaseClient, event: PaddleTransactionWebhookEvent, grant?: typeof grantAiCredits): Promise<void>`. Consumed by Task 8.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/paddle-webhook.server.test.ts` (add `applyPaddleCreditPackEvent, type PaddleTransactionWebhookEvent` to the existing import on line 3):

```ts
import {
  applyPaddleCreditPackEvent,
  applyPaddleSubscriptionEvent,
  verifyPaddleSignature,
  type PaddleSubscriptionWebhookEvent,
  type PaddleTransactionWebhookEvent,
} from "./paddle-webhook.server";
```

```ts
function fakeCreditPackDb(config: { pack: Terminal; purchaseInsert: Terminal }) {
  const from = mock((table: string) => {
    if (table === "credit_packs") return fakeChain(config.pack);
    if (table === "credit_pack_purchases") return fakeChain(config.purchaseInsert);
    throw new Error(`unexpected table ${table}`);
  });
  return { db: { from } as never };
}

function baseTransactionEvent(
  overrides: Partial<PaddleTransactionWebhookEvent["data"]>,
): PaddleTransactionWebhookEvent {
  return {
    event_type: "transaction.completed",
    data: {
      id: "txn_123",
      customer_id: "ctm_123",
      items: [{ price: { id: "pri_pack_small" } }],
      custom_data: { user_id: "user-1" },
      ...overrides,
    },
  };
}

describe("applyPaddleCreditPackEvent", () => {
  test("grants credits on first delivery of a known pack purchase", async () => {
    const { db } = fakeCreditPackDb({
      pack: { data: { id: "pack-1", credits: 10 }, error: null },
      purchaseInsert: { data: [{ id: "purchase-1" }], error: null },
    });
    const grant = mock(async () => 42);
    await applyPaddleCreditPackEvent(db, baseTransactionEvent({}), grant);
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledWith(db, "user-1", 10);
  });

  test("does not grant again on a retried webhook delivery", async () => {
    const { db } = fakeCreditPackDb({
      pack: { data: { id: "pack-1", credits: 10 }, error: null },
      purchaseInsert: { data: [], error: null }, // ignoreDuplicates: true -> empty rows on conflict
    });
    const grant = mock(async () => 42);
    await applyPaddleCreditPackEvent(db, baseTransactionEvent({}), grant);
    expect(grant).not.toHaveBeenCalled();
  });

  test("is a no-op when the price id doesn't match a known pack (e.g. a subscription renewal)", async () => {
    const { db } = fakeCreditPackDb({
      pack: { data: null, error: null },
      purchaseInsert: { data: [], error: null },
    });
    const grant = mock(async () => 42);
    await applyPaddleCreditPackEvent(db, baseTransactionEvent({}), grant);
    expect(grant).not.toHaveBeenCalled();
  });

  test("skips processing when custom_data.user_id is missing", async () => {
    const { db } = fakeCreditPackDb({
      pack: { data: { id: "pack-1", credits: 10 }, error: null },
      purchaseInsert: { data: [{ id: "purchase-1" }], error: null },
    });
    const grant = mock(async () => 42);
    await applyPaddleCreditPackEvent(db, baseTransactionEvent({ custom_data: null }), grant);
    expect(grant).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/paddle-webhook.server.test.ts`
Expected: FAIL — `applyPaddleCreditPackEvent is not a function`.

- [ ] **Step 3: Implement `applyPaddleCreditPackEvent`**

Append to `src/lib/paddle-webhook.server.ts` (add `import { grantAiCredits } from "@/lib/credits.server";` near the top, after the existing `Database` import):

```ts
export type PaddleTransactionWebhookEvent = {
  event_type: "transaction.completed";
  data: {
    id: string;
    customer_id: string;
    items: Array<{ price: { id: string } }>;
    custom_data: { user_id?: string } | null;
  };
};

export async function applyPaddleCreditPackEvent(
  db: MilaSupabaseClient,
  event: PaddleTransactionWebhookEvent,
  grant: typeof grantAiCredits = grantAiCredits,
): Promise<void> {
  const { data } = event;
  const priceId = data.items[0]?.price.id;
  const { data: pack, error: packError } = await db
    .from("credit_packs")
    .select("id, credits")
    .eq("paddle_price_id", priceId ?? "")
    .maybeSingle();
  if (packError || !pack) return;

  const userId = data.custom_data?.user_id;
  if (!userId) {
    console.error("[paddle-webhook] missing custom_data.user_id", { transactionId: data.id });
    return;
  }

  const { data: insertedRows, error: insertError } = await db
    .from("credit_pack_purchases")
    .upsert(
      {
        user_id: userId,
        credit_pack_id: pack.id,
        paddle_transaction_id: data.id,
        credits_granted: pack.credits,
      },
      { onConflict: "paddle_transaction_id", ignoreDuplicates: true },
    )
    .select("id");
  if (insertError) {
    console.error("[paddle-webhook] failed to record credit pack purchase", insertError);
    return;
  }
  if (!insertedRows || insertedRows.length === 0) return;

  try {
    await grant(db, userId, pack.credits);
  } catch (err) {
    console.error("[paddle-webhook] failed to grant ai credits", err);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/paddle-webhook.server.test.ts`
Expected: PASS, all tests including the 4 new ones and the existing subscription-event ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/paddle-webhook.server.ts src/lib/paddle-webhook.server.test.ts
git commit -m "feat: grant ai credits on completed credit pack purchases"
```

---

### Task 8: Wire `transaction.completed` into the webhook route

**Files:**
- Modify: `src/routes/api/webhooks/paddle.ts`

**Interfaces:**
- Consumes: `applyPaddleCreditPackEvent`, `type PaddleTransactionWebhookEvent` (Task 7); `applyPaddleSubscriptionEvent`, `type PaddleSubscriptionWebhookEvent`, `verifyPaddleSignature` (existing).

- [ ] **Step 1: Replace the file contents**

```ts
import { createFileRoute } from "@tanstack/react-router";
import { requireEnv } from "@/lib/env";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  applyPaddleCreditPackEvent,
  applyPaddleSubscriptionEvent,
  verifyPaddleSignature,
  type PaddleSubscriptionWebhookEvent,
  type PaddleTransactionWebhookEvent,
} from "@/lib/paddle-webhook.server";

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
]);
const TRANSACTION_EVENT_TYPES = new Set(["transaction.completed"]);

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

        const event = JSON.parse(rawBody) as { event_type: string };
        if (SUBSCRIPTION_EVENT_TYPES.has(event.event_type)) {
          await applyPaddleSubscriptionEvent(
            supabaseAdmin,
            event as unknown as PaddleSubscriptionWebhookEvent,
          );
        } else if (TRANSACTION_EVENT_TYPES.has(event.event_type)) {
          await applyPaddleCreditPackEvent(
            supabaseAdmin,
            event as unknown as PaddleTransactionWebhookEvent,
          );
        }

        return Response.json({ ok: true });
      },
    },
  },
});
```

There's no existing test file for this route (the branching logic it delegates to is what `paddle-webhook.server.test.ts` covers); verified manually in Task 11 via the Paddle sandbox webhook simulator.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/webhooks/paddle.ts
git commit -m "feat: route transaction.completed webhooks to credit pack handler"
```

---

### Task 9: Admin UI — credit pack catalog management

**Files:**
- Create: `src/components/admin/credit-pack-columns.tsx`
- Create: `src/components/admin/credit-pack-form-dialog.tsx`
- Create: `src/routes/_authenticated/admin/credit-packs.tsx`
- Modify: `src/lib/authorization.ts`
- Modify: `src/components/admin/admin-sidebar.tsx`
- Modify: `src/components/admin/admin-header.tsx`

**Interfaces:**
- Consumes: `CreditPack` (Task 4), `adminCreditPacksQueryOptions` (Task 6), `adminCreateCreditPack`/`adminUpdateCreditPack`/`adminSetCreditPackArchived`/`adminDeleteCreditPack` (Task 5), `formatPlanPrice`/`parsePriceToCents`/`centsToPriceInput`/`planSlugSchema`/`slugifyPlanTitle` from `@/lib/subscription-plans` (reused, not duplicated).
- Reuses the existing `"subscriptionPlans.manage"` permission rather than adding a new one — it's the same "billing catalog" concern an admin who can edit membership plans should also be trusted with, and inventing a second permission for a 2-item pack catalog would be pure ceremony.

- [ ] **Step 1: Add the route permission**

In `src/lib/authorization.ts`, add one line to `STAFF_ROUTE_PERMISSIONS` (after `"/admin/subscription-plans"`):

```ts
  "/admin/credit-packs": "subscriptionPlans.manage",
```

- [ ] **Step 2: Write the columns component**

```tsx
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatPlanPrice } from "@/lib/subscription-plans";
import type { CreditPack } from "@/lib/credit-packs";

interface CreditPackColumnsOptions {
  onEdit: (pack: CreditPack) => void;
  onToggleActive: (pack: CreditPack, active: boolean) => void;
  onArchive: (pack: CreditPack, archived: boolean) => void;
  onDelete: (pack: CreditPack) => void;
}

export function getCreditPackColumns({
  onEdit,
  onToggleActive,
  onArchive,
  onDelete,
}: CreditPackColumnsOptions): ColumnDef<CreditPack>[] {
  return [
    {
      accessorKey: "title",
      header: () => <span>Pack</span>,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-serif text-sm text-ink truncate">{row.original.title}</span>
            {row.original.archived_at && (
              <Badge
                variant="outline"
                className="border-stone/40 text-stone text-[9px] uppercase tracking-[0.18em]"
              >
                Archived
              </Badge>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-stone mt-0.5 truncate">
            {row.original.slug}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "price_amount",
      header: () => <span>Price</span>,
      cell: ({ row }) => (
        <div className="text-sm text-ink tabular-nums">
          {formatPlanPrice(row.original.price_amount, row.original.currency)}
        </div>
      ),
    },
    {
      accessorKey: "credits",
      header: () => <div className="text-center">Credits</div>,
      cell: ({ row }) => (
        <div className="text-center text-sm text-ink tabular-nums">{row.original.credits}</div>
      ),
    },
    {
      id: "active",
      header: () => <div className="text-center">Active</div>,
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Switch
            checked={row.original.is_active}
            disabled={!!row.original.archived_at}
            aria-label={`${row.original.title} active`}
            onCheckedChange={(v) => onToggleActive(row.original, v)}
          />
        </div>
      ),
    },
    {
      accessorKey: "updated_at",
      header: () => <span>Updated</span>,
      cell: ({ row }) => (
        <span className="text-xs text-stone whitespace-nowrap">
          {new Date(row.original.updated_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const pack = row.original;
        const archived = !!pack.archived_at;
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="size-8 p-0 text-stone hover:text-ink">
                  <Ellipsis className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  <span className="sr-only">Actions for {pack.title}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(pack)}>
                  <Pencil className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onArchive(pack, !archived)}>
                  {archived ? (
                    <>
                      <ArchiveRestore className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                      Restore
                    </>
                  ) : (
                    <>
                      <Archive className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                      Archive
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(pack)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];
}
```

- [ ] **Step 3: Write the form dialog**

```tsx
import { useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FormField } from "@/components/ui/form-field";
import { Label } from "@/components/ui/label";
import { adminCreateCreditPack, adminUpdateCreditPack } from "@/lib/credit-packs.functions";
import {
  planSlugSchema,
  slugifyPlanTitle,
  centsToPriceInput,
  parsePriceToCents,
} from "@/lib/subscription-plans";
import type { CreditPack } from "@/lib/credit-packs";

const formSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .max(80, "Keep the title under 80 characters."),
  slug: planSlugSchema,
  description: z.string().trim().max(280, "Keep the description under 280 characters."),
  price: z
    .string()
    .trim()
    .refine((v) => parsePriceToCents(v) !== null, "Enter a price like 1.99 (max 9,999,999)."),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, "Use a 3-letter currency code, e.g. usd."),
  credits: z.coerce
    .number({ invalid_type_error: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(1, "Credits must be at least 1.")
    .max(1_000_000),
  sort_order: z.coerce
    .number({ invalid_type_error: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(0, "Sort order can't be negative.")
    .max(9999),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

interface CreditPackFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pack?: CreditPack;
  nextSortOrder: number;
  onSaved: () => void;
}

export function CreditPackFormDialog({
  open,
  onOpenChange,
  pack,
  nextSortOrder,
  onSaved,
}: CreditPackFormDialogProps) {
  const isEdit = !!pack;
  const createPack = useServerFn(adminCreateCreditPack);
  const updatePack = useServerFn(adminUpdateCreditPack);
  const slugEdited = useRef(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues(nextSortOrder),
  });

  useEffect(() => {
    if (!open) return;
    slugEdited.current = isEdit;
    reset(
      pack
        ? {
            title: pack.title,
            slug: pack.slug,
            description: pack.description,
            price: centsToPriceInput(pack.price_amount),
            currency: pack.currency,
            credits: pack.credits,
            sort_order: pack.sort_order,
            is_active: pack.is_active,
          }
        : emptyValues(nextSortOrder),
    );
  }, [open, pack, isEdit, nextSortOrder, reset]);

  const titleField = register("title");
  const slugField = register("slug");

  const onSubmit = async (values: FormValues) => {
    const payload = {
      title: values.title,
      slug: values.slug,
      description: values.description,
      price_amount: parsePriceToCents(values.price) ?? 0,
      currency: values.currency,
      credits: values.credits,
      sort_order: values.sort_order,
      is_active: values.is_active,
    };
    try {
      if (isEdit) {
        await updatePack({ data: { id: pack.id, ...payload } });
        toast.success("Pack updated.");
      } else {
        await createPack({ data: payload });
        toast.success("Pack created.");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the pack.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {isEdit ? "Edit Credit Pack" : "Create Credit Pack"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit
              ? "Update this credit pack. Changes to active packs are visible to members immediately."
              : "New packs start where you set the Active switch — leave it off to prepare a draft. After creating it, set its Paddle price ID directly in the database once the matching one-time Price exists in Paddle."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <FormField label="Title" htmlFor="pack-title" required error={errors.title?.message}>
            <Input
              id="pack-title"
              {...titleField}
              onChange={(e) => {
                titleField.onChange(e);
                if (!slugEdited.current) {
                  setValue("slug", slugifyPlanTitle(e.target.value), { shouldValidate: false });
                }
              }}
            />
          </FormField>

          <FormField
            label="Slug"
            htmlFor="pack-slug"
            required
            error={errors.slug?.message}
            description="Stable identifier used by application code. Don't change it casually on an existing pack."
          >
            <Input
              id="pack-slug"
              {...slugField}
              onChange={(e) => {
                slugEdited.current = true;
                slugField.onChange(e);
              }}
            />
          </FormField>

          <FormField label="Description" htmlFor="pack-description" error={errors.description?.message}>
            <Textarea id="pack-description" rows={2} {...register("description")} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Price" htmlFor="pack-price" required error={errors.price?.message}>
              <Input id="pack-price" inputMode="decimal" placeholder="1.99" {...register("price")} />
            </FormField>
            <FormField label="Currency" htmlFor="pack-currency" required error={errors.currency?.message}>
              <Input id="pack-currency" maxLength={3} {...register("currency")} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Credits" htmlFor="pack-credits" required error={errors.credits?.message}>
              <Input id="pack-credits" type="number" min={1} {...register("credits")} />
            </FormField>
            <FormField label="Sort Order" htmlFor="pack-sort-order" error={errors.sort_order?.message}>
              <Input id="pack-sort-order" type="number" min={0} {...register("sort_order")} />
            </FormField>
          </div>

          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="is_active"
              render={({ field }) => (
                <Switch id="pack-active" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="pack-active">Active</Label>
          </div>

          <DialogFooter className="pt-1">
            <Button type="submit" loading={isSubmitting} size="sm">
              {isEdit ? "Save Changes" : "Create Pack"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function emptyValues(nextSortOrder: number): FormValues {
  return {
    title: "",
    slug: "",
    description: "",
    price: "",
    currency: "usd",
    credits: 10,
    sort_order: nextSortOrder,
    is_active: false,
  };
}
```

- [ ] **Step 4: Write the admin route page**

```tsx
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { getCreditPackColumns } from "@/components/admin/credit-pack-columns";
import { CreditPackFormDialog } from "@/components/admin/credit-pack-form-dialog";
import { queryKeys } from "@/constants/query-keys";
import { adminCreditPacksQueryOptions } from "@/lib/queries/credit-packs";
import {
  adminDeleteCreditPack,
  adminSetCreditPackArchived,
  adminUpdateCreditPack,
} from "@/lib/credit-packs.functions";
import type { CreditPack } from "@/lib/credit-packs";
import { requireStaffRoutePermission } from "@/lib/staff-route";

export const Route = createFileRoute("/_authenticated/admin/credit-packs")({
  beforeLoad: ({ context }) =>
    requireStaffRoutePermission(context.queryClient, "subscriptionPlans.manage"),
  component: CreditPacksPage,
});

function CreditPacksPage() {
  const qc = useQueryClient();
  const updatePack = useServerFn(adminUpdateCreditPack);
  const setArchived = useServerFn(adminSetCreditPackArchived);
  const deletePack = useServerFn(adminDeleteCreditPack);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<CreditPack | undefined>(undefined);

  const { data, isLoading, isError, refetch } = useQuery(adminCreditPacksQueryOptions());
  const packs = data ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: queryKeys.adminCreditPacks });
    qc.invalidateQueries({ queryKey: queryKeys.creditPacks });
  }

  async function run(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      toast.success(successMessage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the pack.");
    } finally {
      invalidate();
    }
  }

  function openCreate() {
    setEditingPack(undefined);
    setFormOpen(true);
  }

  function openEdit(pack: CreditPack) {
    setEditingPack(pack);
    setFormOpen(true);
  }

  const columns = getCreditPackColumns({
    onEdit: openEdit,
    onToggleActive: (pack, active) =>
      run(
        () => updatePack({ data: { id: pack.id, is_active: active } }),
        active ? `“${pack.title}” is now public.` : `“${pack.title}” is now hidden.`,
      ),
    onArchive: (pack, archived) =>
      run(
        () => setArchived({ data: { id: pack.id, archived } }),
        archived ? `“${pack.title}” archived.` : `“${pack.title}” restored (still inactive).`,
      ),
    onDelete: (pack) => {
      if (
        !window.confirm(
          `Delete “${pack.title}” permanently? This cannot be undone.\n\nPrefer archiving if this pack may ever be referenced by a purchase.`,
        )
      ) {
        return;
      }
      void run(() => deletePack({ data: { id: pack.id } }), "Pack deleted.");
    },
  });

  if (isError) {
    return (
      <div className="rounded-panel border border-porcelain/60 bg-atelier-panel/40 px-6 py-14 text-center">
        <p className="font-serif text-lg text-ink">Couldn't load credit packs</p>
        <p className="mt-1 text-sm text-stone">Check your connection and try again.</p>
        <Button size="sm" variant="outline" className="mt-5" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <DataTable
        columns={columns}
        data={packs}
        isLoading={isLoading}
        searchable
        searchPlaceholder="Search by title or slug"
        searchText={(p) => `${p.title} ${p.slug}`}
        countLabel="packs"
        emptyMessage="No credit packs yet. Create the first one."
        action={
          <Button size="sm" className="h-9 text-xs gap-1.5" onClick={openCreate}>
            <Plus className="size-3.5" />
            Create Pack
          </Button>
        }
      />

      <CreditPackFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        pack={editingPack}
        nextSortOrder={packs.length ? Math.max(...packs.map((p) => p.sort_order)) + 1 : 0}
        onSaved={invalidate}
      />
    </div>
  );
}
```

- [ ] **Step 5: Add the nav link**

In `src/components/admin/admin-sidebar.tsx`, add `Coins` to the `lucide-react` import (alongside the existing `CreditCard` etc.), and add an entry to `ADMIN_LINKS` right after the `"/admin/subscription-plans"` entry:

```ts
  {
    to: "/admin/credit-packs",
    label: "Credit Packs",
    icon: Coins,
    permission: STAFF_ROUTE_PERMISSIONS["/admin/credit-packs"],
  },
```

- [ ] **Step 6: Add the page header metadata**

In `src/components/admin/admin-header.tsx`, add an entry to `PAGE_META` (after `"/admin/subscription-plans"`):

```ts
  "/admin/credit-packs": {
    title: "Credit Packs",
    subtitle: "Manage one-time top-up packs",
  },
```

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Manual QA**

Run: `bun run dev`, sign in as an admin, open `/admin/credit-packs`.
Expected: page loads via the sidebar "Credit Packs" link; create a pack (e.g. title "Test Pack", price 1.99, credits 10, Active on); it appears in the table; toggling Active, editing, archiving, and deleting all work with toast confirmations, matching the existing `/admin/subscription-plans` page's behavior.

- [ ] **Step 9: Commit**

```bash
git add src/components/admin/credit-pack-columns.tsx src/components/admin/credit-pack-form-dialog.tsx src/routes/_authenticated/admin/credit-packs.tsx src/lib/authorization.ts src/components/admin/admin-sidebar.tsx src/components/admin/admin-header.tsx
git commit -m "feat: add admin credit pack catalog management"
```

---

### Task 10: Self-serve purchase — `UpgradeSlotsDialog`

**Files:**
- Modify: `src/components/dashboard/upgrade-slots-dialog.tsx`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/routes/_authenticated/_app/dashboard.tsx`

**Interfaces:**
- Consumes: `publicCreditPacksQueryOptions` (Task 6), `usePaddleCheckout` (existing, unchanged — its `openCheckout(plan, user)` param is typed as `Pick<PublicSubscriptionPlan, "paddle_price_id">`, which a `PublicCreditPack` satisfies structurally), `formatPlanPrice` from `@/lib/subscription-plans`.

- [ ] **Step 1: Rewrite the dialog**

```tsx
import { Sparkles, Zap } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { publicCreditPacksQueryOptions } from "@/lib/queries/credit-packs";
import { formatPlanPrice } from "@/lib/subscription-plans";

export function UpgradeSlotsDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user: { id: string; email?: string } | null | undefined;
}) {
  const { data: packs } = useQuery({
    ...publicCreditPacksQueryOptions(),
    enabled: open,
  });
  const { openCheckout, ready } = usePaddleCheckout(user?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mx-auto sm:mx-0 mb-2 inline-flex items-center justify-center size-12 rounded-full bg-atelier-champagne/20 ring-1 ring-atelier-champagne/40">
            <Zap className="size-5 text-foreground" strokeWidth={1.75} />
          </div>
          <DialogTitle className="font-serif text-2xl">Studio Energy Depleted</DialogTitle>
          <DialogDescription>
            You've used today's complimentary styling credits. Upgrade your membership for a bigger
            daily allowance, or top up now to keep going today.
          </DialogDescription>
        </DialogHeader>

        <Button asChild className="w-full" onClick={() => onOpenChange(false)}>
          <Link to="/pricing">View Membership Plans</Link>
        </Button>

        {packs && packs.length > 0 && (
          <div className="mt-2 space-y-3">
            {packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                disabled={!ready || !user?.id}
                onClick={() => user?.id && openCheckout(pack, { id: user.id, email: user.email })}
                className="w-full flex items-center justify-between gap-4 border border-border p-4 text-left hover:border-foreground/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="flex items-start gap-3">
                  <Sparkles className="size-4 mt-0.5 text-atelier-champagne" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">{pack.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {pack.description || `+${pack.credits} styling credits`}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-medium shrink-0">
                  {formatPlanPrice(pack.price_amount, pack.currency)}
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Update the two callers**

In `src/components/layout/app-shell.tsx`, replace:

```tsx
        <UpgradeSlotsDialog
          open={creditPaywallOpen}
          onOpenChange={setCreditPaywallOpen}
          variant="credits"
        />
```

with:

```tsx
        <UpgradeSlotsDialog open={creditPaywallOpen} onOpenChange={setCreditPaywallOpen} user={user} />
```

In `src/routes/_authenticated/_app/dashboard.tsx`, replace:

```tsx
      <UpgradeSlotsDialog
        open={creditPaywallOpen}
        onOpenChange={setCreditPaywallOpen}
        variant="credits"
      />
```

with:

```tsx
      <UpgradeSlotsDialog open={creditPaywallOpen} onOpenChange={setCreditPaywallOpen} user={user} />
```

(Both files already have `const { user } = useAuth();` in scope — no new import needed.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors — confirms `PublicCreditPack` structurally satisfies `openCheckout`'s parameter type.

- [ ] **Step 4: Manual QA (Paddle sandbox)**

Using the `paddle:sandbox-testing` conventions already established in this project (sandbox environment, test cards):
1. As an admin, create an active credit pack in `/admin/credit-packs`, then create a matching one-time Price in the Paddle sandbox dashboard and paste its price ID into `credit_packs.paddle_price_id` directly (Supabase Studio).
2. As a test user, deplete today's AI credits until the paywall dialog opens.
3. Confirm the pack now renders as a real, clickable button (not the old disabled stub) with its live price.
4. Click it, complete checkout with a Paddle test card.
5. Confirm the Paddle sandbox delivers a `transaction.completed` webhook to `/api/webhooks/paddle`, and that the user's `ai_credits` increases by the pack's `credits` value.
6. Replay the same webhook payload (Paddle's webhook simulator, or re-POST the captured body) and confirm `ai_credits` does **not** increase a second time (idempotency).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/upgrade-slots-dialog.tsx src/components/layout/app-shell.tsx src/routes/_authenticated/_app/dashboard.tsx
git commit -m "feat: let depleted users buy a credit pack from the paywall dialog"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS, all tests including the new ones from Tasks 3 and 7.

- [ ] **Step 2: Typecheck the whole project**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 4: Re-run the end-to-end manual QA from Task 10, Step 4, start to finish**

Expected: deplete → paywall → buy pack → webhook grants credits → generation works again same day → replayed webhook does not double-grant.
