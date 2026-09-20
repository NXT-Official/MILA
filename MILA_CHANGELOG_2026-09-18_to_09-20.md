# MILA Engineering Update — September 18–20, 2026

**Prepared for:** Dev team, CEO
**Period covered:** September 18–20, 2026 (6 commits, all deployed to production)
**Live app:** https://mila-umber.vercel.app

## Summary

Over the past three days we finished migrating MILA's AI stack onto OpenRouter, shipped a new feature (the identity-locked style sheet), and then found and fixed three separate production bugs that were degrading the core "Create my look" experience — including one that was silently breaking every photo-based generation. We also made a product call to drop the generic stock-photo "outfit inspiration" image in favor of always showing the user's own photo-based visual.

Net effect for users: "Create my look" is more reliable, shows the user's actual likeness by default instead of a stock model, saved looks display correctly in history, and outfit recommendations now point to real, purchasable products instead of AI-invented ones.

---

## 1. AI stack consolidation (Sept 18)

Replaced the previous multi-provider setup (Gemini + Cloudflare fallback chain) with a single provider, OpenRouter, for all text/vision and image generation:

- **Text/vision reasoning:** `deepseek/deepseek-v4.1-flash` — handles outfit composition, item detection, color analysis, and photo-edit QA verification.
- **Image generation:** `meta/muse-image` — handles both text-to-image and image-to-image (photo editing).
- Removed all Cloudflare AI code paths and credentials. `OPENROUTER_API_KEY` is now the only AI credential the app needs.
- Added a new internal API layer (`/api/v1/...`) mirroring the web app's functionality for the mobile app team to build against.

**Why:** simpler credential management, one vendor relationship, and access to `meta/muse-image` for higher-quality image edits.

Two follow-up fixes were needed to get this working correctly in production:
- `meta/muse-image` turned out to require OpenRouter's dedicated Images API endpoint, not the standard chat endpoint — image generation was 404ing until this was corrected.
- The face-recognition library's Node.js compatibility shim needed adjustment after the bundler change — this surfaced again later (see #4 below).

---

## 2. Real shoppable product picks + new style sheet feature (Sept 20)

- The AI stylist now recommends outfits **only from our real, in-stock product catalog** — it can no longer invent items, prices, or links. Every "shop this look" recommendation is a live, purchasable product, reasoned against the user's actual face shape and skin tone.
- Shipped a new feature: an **identity-locked 5-view style sheet** — a single generated image showing the user's own likeness (from their consented selfie) wearing the recommended outfit from five angles (face close-up, front, back, left profile, right profile). This is a meaningfully richer visual than the old single-photo preview.

---

## 3. Production bug fixes (Sept 20)

Shortly after the above shipped, we identified and fixed three separate bugs affecting the live product, all confirmed directly against production logs and database records (not guessed):

**a. Photo verification was silently broken.**
Every photo-based "Create my look" generation runs through a face-match safety check before showing the result to the user. That check was crashing in production due to two bundler-related issues (a missing Node.js global in our serverless environment, and model files that weren't being included in the deployed build). Users were seeing "couldn't be verified safe" errors far more often than expected. Fixed by moving the face-recognition model to run on a more compatible backend and load its files from a CDN instead of local disk — verified working end-to-end before deploying.

**b. The AI was overriding its own instructions during photo edits.**
The image-editing prompt told the AI to reframe close-up selfies into "full-body" shots, while a separate instruction told it to preserve the original framing and pose exactly. These two instructions conflicted, and the AI was resolving it by changing the photo's composition — which then correctly got flagged and rejected by our safety check, creating repeat failures. Fixed by removing the conflicting instruction.

**c. Saved looks were failing to display in the "Your Archive" history page.**
Any saved look where no makeup was recommended (e.g., for male users) was being rejected by a display bug and showing "This saved look is no longer available," even though the data was perfectly intact. Confirmed by inspecting the actual saved record. One-line fix.

---

## 4. Product change: removed the stock-photo "outfit inspiration" image (Sept 20)

Previously, users without a saved photo (or as an initial step for everyone) saw a generic AI-generated photo of a stock model wearing the outfit — not the user themselves. Per product direction, this has been **removed entirely**. Now:

- Users with a consented photo on file get the identity-locked style sheet (their own likeness) as the primary visual automatically.
- The single-photo edit preview remains available as an optional secondary view.
- Users without a photo on file see the outfit description with no visual, and are prompted to add a photo to unlock visuals.

This makes every generated visual in the app the user's own likeness — no more generic stock-model output.

---

## What's next / open items

- The mobile app's `/api/v1/look/image` endpoint still serves the older stock-model image generation for now — untouched by the web dashboard change, since it's a separate API surface. Worth a follow-up discussion on whether mobile should get the same treatment.
- Face-match threshold (how strict the "is this the same person" check is) is currently tuned conservatively and logs distance scores on every check — worth revisiting once we have more production data.

---

*Six commits, all typechecked, tested (216/216 passing), and deployed to production. Happy to walk through any of this live.*
