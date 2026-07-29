# Shoppable OOTD (feed item tagging + dupes) — design

Status: **TODO / not started.** Written 2026-07-28 from the client ask in `#mila-general`.

## Context

Reference: TikTok's shopping overlay. On an OOTD video TikTok pins a hotspot per garment
("Sleeveless tops", "Find similar"), and tapping one opens a drawer with two tabs — **Top**
(similar community posts) and **Shop** (buyable products, sorted by best match / best
sellers / top rated / price).

The ask: when a user posts their OOTD to the feed, Mila identifies each piece (tank top,
jeans, sneakers, earrings), the poster can tag where each piece is from with a link, and
Mila surfaces dupes/alternatives available online. Monetizable via affiliate commission.

**Most of the backend already exists.** This is mostly composition, not new infrastructure:

- `analyzeClothing` (`src/lib/analyze-clothing.functions.ts`) — vision → structured
  `ClothingAttributes` (name, category, primary_color, color_undertone, silhouette_tags),
  already credit-gated (`withAiCredit`) and rate-limited.
- `findDupes` (`src/lib/dupe-hunter.functions.ts`) — attributes → ranked `products` with
  `affiliate_link`, `match_score`, `match_reasons`. Already has the scoring heuristic.
- `products` / `brands` tables — `affiliate_link`, `commission_rate`, `affiliate_network`
  are all already columns.
- `posts` table + `PostCanvas` (`src/components/feed/post-canvas.tsx`) — the render target.

### The actual gaps

1. `analyzeClothing` takes **one garment per image**. An OOTD photo is 3–6 garments. Needs a
   multi-item variant that returns an array, each with a normalized bounding box so the
   hotspot can be positioned on the photo.
2. No table linking a post to its tagged pieces.
3. No hotspot/drawer UI on `PostCanvas`.
4. No affiliate click attribution. `ad_events` exists but its `ad_type` CHECK is
   `('banner','rewarded','interstitial')` — doesn't cover an outbound product click.

## Scope

In scope:

- Multi-item detection on post: one AI call per OOTD returning N items + bboxes.
- `post_items` table: post_id, label, category, attributes JSONB, bbox, optional
  `source_url` (poster-supplied link) and optional `product_id` (catalog match).
- Poster-side tagging UI: after capture, Mila's detected pieces are listed; poster confirms/
  edits each and can paste where it's from. Skippable — a post with zero tags still posts.
- Viewer-side: hotspots on the photo, tap → drawer showing the poster's link (if given) plus
  `findDupes` results for that piece.
- Affiliate click logging for revenue attribution.

Out of scope for v1:

- The "Top" tab (similar community posts). Needs post embeddings; the Shop tab is where the
  money is. Add when the feed has enough volume for similarity to be non-embarrassing.
- Live catalog ingestion from real affiliate networks. `products` is seeded with a handful
  of rows — dupes will look thin until a real feed is wired in. **This is the biggest
  execution risk in the whole feature**, and it's a business/partnership problem, not a
  code one.
- Detection on the front (face/hair) capture — jewelry/earrings are usually only visible
  there, so accept that v1 misses some accessories.
- Editing tags after a post is published.

## Decisions

**One AI call per post, not per garment.** A per-garment call means N credits for one post
and N times the latency. One vision call returns the array. Reuse the existing tool-calling
shape in `analyze-clothing.functions.ts` — same tool, wrapped in an array property.

**Detection runs on post, not on view.** Results are persisted to `post_items` once. A feed
of 20 posts must never trigger 20 vision calls. Charge the poster 1 credit at post time.

**`findDupes` runs on drawer open, not on post.** Nobody taps most hotspots, and catalog
matching is cheap to redo later. Cache per `post_item` for ~24h so repeat viewers of a
popular post don't each burn a call. Note: `findDupes` currently re-extracts attributes from
an image — it needs an overload that accepts already-extracted `ClothingAttributes` so the
drawer path skips the redundant vision call entirely. That refactor is the one real code
change to existing files.

**Bounding boxes as normalized 0–1 floats**, so hotspots survive any render size. Ask the
model for them in the same tool call; expect them to be roughly right, not pixel-accurate —
a hotspot dot only needs to land on the garment, not trace it.

**Poster links are untrusted input.** `source_url` is user-supplied and rendered as an
outbound link on other people's screens. Validate scheme (`https:` only) on write, render
with `rel="noopener noreferrer nofollow"`, and show the bare hostname rather than the raw
URL so a link can't visually impersonate another domain. Non-negotiable.

**Click attribution: extend `ad_events` rather than add a table.** Add `'affiliate'` to the
`ad_type` CHECK and log `event='click'` with `placement='feed_post_item'` and metadata
`{post_item_id, product_id, brand_id}`. Commission is then a join against
`brands.commission_rate`. Reuses the existing analytics surface instead of building a
parallel one.

## Monetization

Three tiers, in the order they should be attempted:

1. **Affiliate commission on dupe clicks** — works day one, needs no partner negotiation
   beyond joining networks. `brands.commission_rate` is already there. Realistic take is
   low single-digit % of a small conversion rate; it funds the feature, it isn't a business
   on its own until volume is real.
2. **Promoted placement in the Shop drawer** — a brand pays to rank above organic match
   score. Higher margin, but only sellable once there's traffic to sell, and it degrades
   the "Mila found you the honest dupe" trust that makes the feature work at all. Needs a
   visible "Promoted" label if it ships.
3. **Creator revenue share on poster-supplied links** — the poster earns when someone buys
   their tagged piece. This is the retention play more than the revenue play: it gives
   users a reason to tag carefully, which is what makes the whole feature's data good.
   Requires payouts infrastructure that doesn't exist yet.

Recommendation: ship (1) only. It's the one that needs no new business relationships and no
payouts. Revisit (2) and (3) once there's a month of click data to size them against.

## Rough sequencing

1. `post_items` migration + RLS (readable with the post, writable by post owner).
2. `analyzeOutfitItems` server fn — multi-item + bbox. Test with a fixture image.
3. Wire into the post flow in `feed.tsx` `handleSubmit`, after upload, before/alongside
   `createPost`. Must not block the post if detection fails — post first, tag second.
4. Tagging sheet (poster confirms pieces, optionally pastes links).
5. Hotspots + Shop drawer on `PostCanvas`.
6. `findDupes` attributes-overload + drawer wiring + click logging.

Steps 1–3 are the load-bearing half; 4–6 are UI on top of settled data.

## Open questions

- Credit cost for detection: 1 credit per post, or free to encourage posting? Free makes
  the feed data richer, which is what the Shop drawer's value depends on. Leaning free, but
  it's a cost call, not a code call.
- What happens when the catalog has no plausible dupe for a piece? An empty drawer is worse
  than no hotspot. Suggest: only render a hotspot once at least one match above a score
  threshold exists, computed at post time.
