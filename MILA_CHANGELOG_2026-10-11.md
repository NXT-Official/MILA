# MILA Engineering Update — October 11, 2026

**Prepared for:** Dev team
**Branch:** `nicoleDev` (on top of `main` `db7fb57`; fast-forward, not yet merged)
**Why:** members testing the live app couldn't find Sign out. It was three clicks and a scroll deep (avatar → Account → Preferences → the button at the very bottom).

## Sign out from the avatar

- The avatar (desktop sidebar, expanded or collapsed, and the phone-width header) now opens a small account menu: her name and @handle, **Your account** (→ `/account`, as before) and **Sign out**. This is the usual place, two clicks from anywhere.
- Sign out runs through the existing `useAuth().signOut`: this device only, the same failure toast, and a hard return to `/`. While it is out the item reads "Signing out…" and takes no second press. If it fails, she stays signed in on the same page and can press it again.
- Every earlier way out stays: Preferences' "Sign Out of Studio", the onboarding header icon, the suspended screen, and sign-out after account deletion.
- On phone widths the menu rows are 44px tall. Keyboard works too: Enter opens the menu, arrows and End move, Enter signs out.

## Tests

- `profile-menu.test.tsx`, `sidebar.test.tsx` and `app-shell.test.tsx` pin that both avatars are menu buttons, not links away.
- `tests/e2e/auth-session.spec.ts` gains "sign out from the avatar", 8 browser tests: desktop, collapsed sidebar, 375px phone, a touch phone with 44px targets, keyboard, "Your account" still reaching a live `/account`, the pending state with one request, and a failed sign-out with retry. Each checks that the session really ended (the token is gone and `/dashboard` goes to `/login`), not just the URL. Run them against a fake-Supabase dev server; the spec header has the steps.

## Noticed, not changed

- A 500 from the auth server during sign-out shows the offline wording ("You're offline, so we couldn't sign you out yet…"). The Preferences button does the same today.
- `tests/e2e/concierge-recovery.spec.ts` "leaving mid-reply and coming back…" fails on `main` `db7fb57` as well, unrelated to this change.
