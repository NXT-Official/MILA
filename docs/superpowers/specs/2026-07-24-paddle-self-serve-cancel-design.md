# Paddle self-serve cancel — design

## Context

Sub-project #1 (webhook receiver + subscription sync) and #2 (pricing page checkout) are
both live: `subscriptions` mirrors Paddle state, `POST /api/webhooks/paddle` keeps it in
sync, and the pricing page can create real subscriptions end to end (verified with two
sandbox purchases).

`StudioMembershipDrawer` (`src/components/account/studio-membership-drawer.tsx`) has a
`membership` view that's never been updated to know any of this exists — it hardcodes
`Current Tier: Free`. This spec adds a real "Manage Membership" section there: current
plan/renewal state, and a Cancel button. Showing current-plan state was explicitly
deferred in sub-project #2's spec ("belongs to a future subscription-update sub-project");
it's back in scope here because a cancel action has nowhere sensible to live without it.

## Scope

In scope:
- `mySubscriptionQueryOptions` — read the caller's own in-force subscription (RLS-scoped)
- `cancelMySubscription` server function — cancels via Paddle's API, `effective_from:
  "next_billing_period"` only
- `StudioMembershipDrawer` membership view: real plan/renewal display + Cancel button +
  confirmation dialog

Out of scope (future sub-projects, unchanged from prior specs):
- Resume / undo a scheduled cancellation
- "Cancel immediately" (with proration/refund)
- Plan upgrade/downgrade
- Paddle's hosted Customer Portal (explicitly rejected in favor of an in-app button — see
  "Cancel approach" decision below)

## Cancel approach

**Custom in-app button**, not Paddle's hosted Customer Portal. The app's UI is fully
bespoke (the "atelier" boutique aesthetic) with no existing redirect-to-third-party
pattern anywhere; a Portal redirect would break that, and it also hands over invoice/
payment-method management that wasn't asked for. The trade-off is more code and owning the
confirmation UX ourselves — accepted.

## Architecture

- New query `src/lib/queries/subscriptions.ts` — `mySubscriptionQueryOptions(userId)`:
  reads the authenticated user's own row from `subscriptions` via the browser `supabase`
  client (RLS already permits `user_id = auth.uid()`), embedding the plan's `title`,
  `price_amount`, `currency`, `billing_interval` via the existing FK
  (`subscriptions_plan_id_fkey`). Filters to the same "in force" status set the webhook
  handler already uses (`active`, `trialing`, `past_due`), newest row.
- New server function `src/lib/subscriptions.functions.ts` — `cancelMySubscription`, a
  `createServerFn` behind `requireSupabaseAuth` (same pattern as
  `subscription-plans.functions.ts`). **Takes no `subscriptionId` input.** It looks up the
  caller's own in-force subscription server-side via `context.userId` — the same lookup
  `mySubscriptionQueryOptions` does. This is deliberately simpler than the reference
  `paddle:subscription-cancel` pattern (which bridges through an email → customer →
  subscription chain to verify ownership of a client-supplied ID): our schema already ties
  `subscriptions.user_id` directly to the caller, and only one in-force subscription can
  exist per user, so there's no ID for a caller to substitute in the first place.
- Calls Paddle directly via `fetch` with `PADDLE_SANDBOX_API_KEY` —
  `POST /subscriptions/{id}/cancel`, body `{ effective_from: "next_billing_period" }` —
  matching the raw-fetch convention already established in sub-projects #1/#2 (no
  `@paddle/paddle-node-sdk` dependency).
- `effective_from` is always `"next_billing_period"`. No "cancel immediately" path is
  exposed, per the `subscription-cancel` skill's default guidance: the user paid for the
  period, a generic Cancel button shouldn't cut access off mid-cycle.

## Data flow after clicking Cancel

1. Server function calls Paddle's cancel endpoint. The response's
   `scheduled_change.effective_at` — the real end-of-access date — is accurate
   immediately, unlike `status`, which Paddle keeps as `active` until the period actually
   ends. That date is returned directly to the client.
2. Client shows "Your membership ends on `<date>`" using that returned date — not by
   mutating local subscription state optimistically.
3. In parallel, Paddle fires a `subscription.updated` webhook (already handled by
   sub-project #1) that sets `cancel_at_period_end = true` on the mirrored row.
   `mySubscriptionQueryOptions`'s query key is invalidated ~4s later (same delayed-
   invalidate pattern as checkout in sub-project #2) so the drawer picks up the
   authoritative DB state.
4. At the actual period end, Paddle fires the terminal event; the existing webhook handler
   already flips `status` away from in-force and revokes `ads_removed` — no changes needed
   there, sub-project #1 already built this half.

## UI

- `StudioMembershipDrawer`'s `membership` view: if an in-force subscription exists, replace
  the hardcoded `Current Tier: Free` block with the plan title, price, and either
  "Renews `<date>`" or (if `cancel_at_period_end`) "Ends `<date>`" — plus a **Cancel
  Membership** button, hidden once a cancellation is already scheduled. No subscription →
  today's "Free" + "View Membership Plans" link, unchanged.
- Clicking Cancel opens a confirmation `Dialog` (existing primitive, no new dependency):
  "Cancel your membership? You'll keep access until `<date>`." / Keep Membership / Cancel
  Membership.
- No "undo cancel" / resume action, no immediate-cancel option, no plan switching.

## Error handling

- Server function checks for an in-force subscription itself — never trusts that the
  button was only rendered when one exists. No row found →
  `{ error: "No active membership to cancel" }`.
- Paddle API call fails (permissions, network, etc.) → generic
  `{ error: "Couldn't cancel your membership. Try again in a moment." }`, logged
  server-side with the real cause; the raw Paddle error never reaches the client.
- The Cancel button disables while the request is in flight, so a double-click can't fire
  two cancel calls.

## Testing

- Core logic extracted into an injectable function —
  `cancelSubscriptionForUser(db, cancelViaPaddle, userId)` — mirroring the
  dependency-injection pattern already used in `auth-handler.server.ts` and
  `paddle-webhook.server.ts` (fake `db` chain, mocked Paddle call, no network). Three
  cases: no in-force subscription → error without calling Paddle; happy path → calls
  Paddle with the right subscription ID and `effective_from: "next_billing_period"`,
  returns the scheduled end date; Paddle call fails → generic error. The `createServerFn`
  itself is thin glue over this — same split as sub-project #2's `usePaddleCheckout`
  wrapping the tested `buildCheckoutOptions`.
- Manual verification: complete a fresh sandbox checkout (sub-project #2's flow), confirm
  the drawer shows the real plan instead of "Free," click Cancel, confirm the dialog and
  the "ends on `<date>`" state, and confirm the webhook eventually flips the mirrored row
  and the drawer reflects it.
