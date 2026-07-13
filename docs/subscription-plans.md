# Subscription Plans

Admin-managed, database-backed membership plan catalog. Replaces the need for
hardcoded plan constants. **Catalog only** — no payments, checkout, or
entitlement fulfillment exist yet (see "Not implemented" below).

## Schema — `public.subscription_plans`

Migration: `supabase/migrations/20260713120000_create_subscription_plans.sql`

| Column                      | Type         | Notes                                                         |
| --------------------------- | ------------ | ------------------------------------------------------------- |
| `id`                        | uuid PK      |                                                               |
| `slug`                      | text unique  | `^[a-z0-9]+(-[a-z0-9]+)*$`, 2–60 chars; stable app identifier |
| `title`                     | text         | non-empty, ≤ 80 chars                                         |
| `description`               | text         | ≤ 280 chars                                                   |
| `price_amount`              | integer ≥ 0  | smallest currency unit (cents) — **never floats**             |
| `currency`                  | text         | lowercase 3-letter code, default `usd`                        |
| `billing_interval`          | text         | `monthly` \| `yearly` \| `one_time` (check constraint)        |
| `credits_included`          | integer ≥ 0  |                                                               |
| `features`                  | text[]       | public bullet points                                          |
| `is_active`                 | boolean      | default **false** — new plans start hidden                    |
| `is_featured`               | boolean      | at most one featured non-archived plan (partial unique index) |
| `sort_order`                | integer ≥ 0  | public + admin display order                                  |
| `archived_at`               | timestamptz? | soft delete; archived plans are never shown publicly          |
| `created_at` / `updated_at` | timestamptz  | `updated_at` via shared `update_updated_at_column()` trigger  |

Indexes: `(is_active, sort_order)` for the public listing; partial unique
index `subscription_plans_single_featured_idx` enforcing the single-featured
rule at the database level.

## Authorization

- **RLS**: authenticated users can `SELECT` only rows where
  `is_active AND archived_at IS NULL`; admins (via `has_role`) can read all
  rows. There are **no write policies** — like `user_roles`, every mutation
  goes through the service-role client.
- **Server functions** (`src/lib/subscription-plans.functions.ts`): every
  handler runs `assertAdmin` (the existing `has_role` check) before touching
  `supabaseAdmin`. All inputs are Zod-validated; only whitelisted columns can
  be written (no mass assignment). Database errors are normalized to safe
  messages (duplicate slug, featured conflict, FK reference).
- The service-role key stays server-side (`client.server.ts`, imported
  dynamically inside handlers only).

## Behavior

- **Active selection**: public surfaces query
  `is_active = true AND archived_at IS NULL`, ordered by `sort_order` then
  `created_at` (deterministic). Shared query:
  `publicSubscriptionPlansQueryOptions()` in
  `src/lib/queries/subscription-plans.ts`.
- **Featured**: at most one featured non-archived plan. Setting a plan
  featured unsets the previous one server-side; the partial unique index
  backstops races. Public UI renders it with a "Recommended" highlight.
- **Ordering**: move up/down in the admin table sends the full id list to
  `adminReorderSubscriptionPlans`, which rewrites `sort_order` by index.
- **Archive vs delete**: archiving (preferred) hides the plan publicly,
  deactivates + unfeatures it, and preserves id/slug for future purchase
  records. Hard delete requires confirmation and fails with a clear message
  if the row is ever referenced by a FK. Never reuse a slug for a materially
  different product.
- **Money**: stored as integer cents; parsed from decimal input with string
  math (`parsePriceToCents`), displayed with `Intl.NumberFormat`
  (`formatPlanPrice`). 2-decimal minor units assumed (usd).

## Surfaces

- **Admin**: `/admin/subscription-plans` — list, create, edit,
  activate/deactivate, feature, reorder, archive/restore, delete.
- **Public**: the membership drawer's Concierge Access panel
  (`src/components/account/membership-plans.tsx`) lists active plans with
  currency-aware prices, intervals, credits, and features. This was the only
  membership-plan surface in the product; the one-time `CREDIT_PACKS`
  preview in `src/constants/app.ts` / `upgrade-slots-dialog.tsx` is a
  separate in-development feature and was deliberately left untouched.
- No seed rows: the product had no real hardcoded subscription plans to
  migrate, and inventing plans/prices was explicitly out of scope. Admins
  create plans; the public panel shows a graceful "announced soon" note
  until then.

## Not implemented (intentionally)

Payment provider integration, checkout sessions, payment webhooks, recurring
subscription lifecycle, refunds/cancellations, entitlement granting, credit
ledger/consumption, and the customer billing portal. The "Acquire Passes"
action in the membership drawer remains disabled with the standard
"In development" treatment.
