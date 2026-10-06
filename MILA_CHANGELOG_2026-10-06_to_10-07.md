# MILA Engineering Update — October 6–7, 2026

**Prepared for:** Dev team
**Branch:** `nicoleDev` (16 commits on top of `main` `f27ff2e`; fast-forward, not yet merged)
**Why:** pre-demo audit of the live site — every member flow walked signed in on production, every finding fixed with a failing test first, each fix reviewed, then a whole-branch review.

## Create my look

- A slow AI review no longer starves the plan stage of its time budget. Since `82bc162` the review retried with ~50 s left, leaving the plan 40 s and ending in "Mila couldn't compose a look". The retry now needs room for a full review plus the plan's minimum; the thin-shortlist recheck follows the same rule.
- "Create my look" and "Try another look" are disabled while the style sheet or a portrait preview is still drawing, and a late sheet or portrait can never attach to a newer look (or be saved with it).
- The weather widget no longer invents a forecast on an API error or hangs on "Detecting weather…"; it labels the fallback and never blocks Create my look.

## Colour read (onboarding and Style Profile)

- Parsing tolerates the model's harmless variations (case, spacing, out-of-range scores, JSON wrapped in prose or reasoning blocks) and retries once on an unusable reply; the whole read finishes inside 165 s so mobile's 180 s timeout never fires after a server success.
- The free founding read is now recorded on every successful read (the profile write it depended on was always refused by RLS).
- The camera-error screen no longer covers Close and "Upload a photo instead"; a busy camera (Zoom, Teams) and a pending permission prompt get plain guidance; errors are plain sentences, never codes; out of credits opens the paywall.
- The live capture is centre-cropped instead of squashed into a square.

## Style dossier

- Every label and swatch comes from the member's own read; the template card that contradicted it is gone; a row of tones in one band gets one caption instead of four identical labels.
- The body type she chose always wins over the AI's guess, and a re-read no longer overwrites it.

## Photos

- Every upload (selfie, Lens, Dupe Hunter, concierge, colour read, Style Analysis) is downscaled to a JPEG in the browser first — no more 413s on phone photos, no PNG/WebP selfies that face-match can't read.

## Dupe Hunter

- Bags and jewellery match bags and jewellery (the AI could only pick six categories, so a bag searched socks and belts).

## Account, sign-up, membership

- Name and @handle come from the username, never the email.
- Deleting an account with a staff-granted plan works (it no longer asks Paddle to cancel a plan Paddle never sold).
- The sign-up toast no longer asks members to confirm an email they never receive.
- The paywall explains membership to members who never had credits; concierge access reads truthfully.
- Signed-in members choosing a plan on the landing page go to `/pricing`.
- Lens "Style Analysis" checks its save and clamps the score to the column's range.

## Dashboard

- The daily palette follows the member's colour season, and its button says "Shuffle palette".
