# Paddle pricing page checkout — design

## Context

Sub-project #1 (webhook receiver + subscription sync) is live: `subscriptions` table,
`profiles.paddle_customer_id`, and `POST /api/webhooks/paddle` all exist and were verified
end-to-end with a real Paddle-signed sandbox event. That handler reads
`data.custom_data.user_id` to link a Paddle subscription back to a Supabase user — nothing
sets that field yet, because nothing initiates checkout.

The pricing page itself already exists (`src/routes/_authenticated/_app/pricing.tsx` +
`src/components/pricing/pricing-card.tsx`): a fully styled 3-card grid backed by
`publicSubscriptionPlansQueryOptions`. The "Choose Plan" button is `disabled` and gated
behind `FEATURES.membershipPurchasing.status === "development"`. This spec covers wiring
that button to a real Paddle Checkout — not building new pricing UI.

## Scope

In scope:
- `@paddle/paddle-js` overlay checkout wired to the existing "Choose Plan" button
- `VITE_PADDLE_CLIENT_TOKEN` / `VITE_PADDLE_ENV` env vars (client token created via the
  Paddle API, not the dashboard)
- Exposing `paddle_price_id` on the public plans query (currently admin-only)
- CSP updates in `vite.config.ts` so the browser doesn't block Paddle's script/iframe
- Flipping `FEATURES.membershipPurchasing` to `"available"` and removing the
  development-mode UI (disabled button, `DevelopmentBadge`, `DevelopmentNotice`)
- Post-checkout UX: success/error toasts, and invalidating the credits query so the nav
  badge picks up the entitlement change once the webhook lands

Out of scope (future sub-projects):
- Showing "your current plan" / blocking re-purchase of an already-active plan — belongs to
  a subscription-update sub-project, which will need to read `subscriptions` state properly
  anyway (upgrade/downgrade, proration) rather than a half-built guard here
- Self-serve cancel, plan changes, customer portal
- A dedicated post-checkout "thank you" route — the pricing page itself handles the
  confirmation via toast, per the overlay checkout style (no page navigation happens)

## Checkout style

**Overlay**, not inline: Paddle's hosted modal opens over the existing card grid on button
click. No new route, no layout work — the pricing page's existing structure (a plan-picker
grid) is exactly what the overlay pattern is for. Inline would require a dedicated
checkout page/section for comparatively little benefit here.

## Architecture

- New dependency: `@paddle/paddle-js` (official client SDK for the hosted checkout iframe —
  no native alternative).
- New env vars, following the existing `VITE_`-prefixed public-key convention
  (`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_HCAPTCHA_SITEKEY`):
  - `VITE_PADDLE_CLIENT_TOKEN` — public client-side token, created via
    `client.clientTokens.create` through the Paddle API (already proven working in
    sub-project #1), not copied from the dashboard.
  - `VITE_PADDLE_ENV=sandbox`
- `PUBLIC_PLAN_COLUMNS` / `PublicSubscriptionPlan` (`src/lib/subscription-plans.ts`)
  currently exclude `paddle_price_id` — the pricing page can't open checkout without it.
  Adding it is a minimal, justified exposure: not sensitive, and RLS already allows
  authenticated read of active plans.
- New hook `src/hooks/use-paddle-checkout.ts`: singleton-guarded `initializePaddle()`
  (guards `paddle?.Initialized` — the SDK itself warns and refuses on double-init), exposes
  `openCheckout(plan: PublicSubscriptionPlan)`:
  ```ts
  paddle.Checkout.open({
    items: [{ priceId: plan.paddle_price_id, quantity: 1 }],
    customer: { email: user.email },
    customData: { user_id: user.id },
    settings: { variant: "one-page" },
  });
  ```
  `customData.user_id` is exactly the field sub-project #1's webhook handler already reads
  (`data.custom_data.user_id`) — this is the piece that connects the whole pipeline
  end to end.
- CSP in `vite.config.ts` (`buildCsp`) currently has no allowance for Paddle at all
  (`script-src 'self' 'unsafe-inline'` plus hCaptcha only; no `frame-src` for a checkout
  iframe; `connect-src` doesn't include Paddle's domains). The exact domains to allowlist
  will be determined empirically during implementation — open the checkout in a real
  browser and add whatever the console's CSP violations name, rather than guessing at
  Paddle's infrastructure domains and getting it subtly wrong.

## Component changes

- `PricingCard` (`src/components/pricing/pricing-card.tsx`): drop `disabled`, wire
  `onClick={() => openCheckout(plan)}`, remove `DevelopmentBadge` and the
  `ctaDescribedById` prop.
- `pricing.tsx`: remove the `DevelopmentNotice` block and `CTA_NOTICE_ID`.
- `src/config/features.ts`: `membershipPurchasing.status` flips `"development"` →
  `"available"`.

## Post-checkout UX

Paddle's overlay fires `checkout.completed` client-side the instant payment succeeds, but
the actual `subscriptions` row and entitlement update only land once our webhook processes
the event — seconds later, not instant. The `eventCallback` in `use-paddle-checkout.ts`
handles:

- `checkout.completed` → `toast.success("Payment received — activating your plan…")`, then
  `queryClient.invalidateQueries({ queryKey: queryKeys.credits(user.id) })` after a short
  delay. That query already exists and drives the credits badge in `app-shell.tsx`
  (`src/components/layout/app-shell.tsx:37-48`) — it's the one piece of UI outside this page
  that will visibly reflect the webhook's entitlement sync once it lands. The pricing page
  itself shows no "current plan" state (see Scope), so there's nothing on this page to
  refetch.
- `checkout.error` → `toast.error("Checkout couldn't load — try again in a moment.")`.

No redirect, no dedicated success route — the overlay closes itself and the toast is the
confirmation, consistent with staying on the pricing page rather than navigating away.

## Error handling

- Missing `VITE_PADDLE_CLIENT_TOKEN` / `VITE_PADDLE_ENV` at runtime → `initializePaddle()`
  is simply never called, `paddle` stays `null`, button stays disabled (no crash — mirrors
  the guard pattern in Paddle's own reference snippet).
- A plan with `paddle_price_id: null` (shouldn't occur for the 3 live plans, but guards
  against an admin-created plan before its Paddle counterpart exists) → button disabled
  rather than opening a checkout that will fail.
- `checkout.error` from the SDK, or a thrown rejection from `Checkout.open` → toast, no
  unhandled promise rejection.

## Testing

- Unit test for the one piece of real logic: verifying the object passed to
  `Checkout.open` — `items[0].priceId` and `customData.user_id` — is built correctly from a
  given plan and user. This is the one field-name typo that would silently break the whole
  pipeline (webhook would fall into its existing "missing custom_data.user_id" fallback
  path, and nothing would ever explain why).
- Manual verification: `bun run dev`, open the pricing page, click a plan, complete checkout
  with a Paddle sandbox test card, confirm the credits badge in the nav updates within a few
  seconds — proving the full loop: checkout → webhook → entitlement sync → UI.
