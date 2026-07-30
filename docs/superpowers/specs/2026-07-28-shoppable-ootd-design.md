# OOTD Item Tagging (feed item detection + similar items) — design

Status: **TODO / not started.** Written 2026-07-28 from the client ask in `#mila-general`.

## Context

Reference: TikTok's shopping overlay. On an OOTD photo or video, TikTok pins a hotspot per garment
("Sleeveless tops", "Find similar"), and tapping one opens a drawer showing visually similar
items.

The ask: when a user posts their OOTD to the feed, Mila identifies each piece (tank top,
jeans, sneakers, earrings), and the poster can optionally tag where each piece is from with
a link. Viewers can tap any garment to see similar pieces and discover visually comparable
styles.

**Most of the backend already exists.** This is mostly composition, not new infrastructure:

- `analyzeClothing` (`src/lib/analyze-clothing.functions.ts`) — vision → structured
  `ClothingAttributes` (name, category, primary_color, color_undertone, silhouette_tags),
  already credit-gated (`withAiCredit`) and rate-limited.
- `findDupes` (`src/lib/dupe-hunter.functions.ts`) — attributes → ranked similar products
  with `match_score` and `match_reasons`. Already has the scoring heuristic.
- `products` / `brands` tables — existing catalog of clothing items.
- `posts` table + `PostCanvas` (`src/components/feed/post-canvas.tsx`) — the render target.

## The actual gaps

1. `analyzeClothing` currently accepts **one garment per image**. An OOTD contains 3–6 garments. It needs a multi-item variant that returns an array, each with a normalized bounding box so hotspots can be positioned on the photo.
2. No table linking a post to its detected clothing pieces.
3. No hotspot/drawer UI on `PostCanvas`.

## Scope

### In scope

- Multi-item detection on post: one AI call per OOTD returning N detected garments + bounding boxes.
- `post_items` table:
  - `post_id`
  - `label`
  - `category`
  - `attributes JSONB`
  - `bbox`
  - optional `source_url` (poster-supplied link)
  - optional `product_id` (catalog match)
- Poster-side tagging UI:
  - after capture, Mila lists detected clothing pieces
  - poster confirms or edits each item
  - optionally pastes where the item came from
  - completely skippable; posts without tags still publish
- Viewer-side:
  - hotspots displayed on the photo
  - tap → drawer showing:
    - the poster's link (if provided)
    - visually similar clothing items returned by `findDupes`

### Out of scope for v1

- Similar community posts ("Top" tab). This requires post embeddings and enough feed volume to make similarity meaningful.
- Live catalog ingestion. The catalog currently contains only seeded data, so similar-item coverage will improve as more products are added.
- Detection on front-camera captures for accessories such as earrings and necklaces.
- Editing tags after publishing.

## Decisions

### One AI call per post, not per garment

A per-garment call means N times the latency and N times the AI cost. Instead, make a single
vision request that returns an array of detected garments using the existing tool schema wrapped
inside an array.

### Detection runs on post, not on view

Detection results are stored once in `post_items`.

A feed containing 20 posts should never trigger 20 vision requests.

### `findDupes` runs on drawer open

Most viewers won't tap every hotspot, so similar-item matching should only happen when needed.

Cache results per `post_item` for roughly 24 hours.

`findDupes` currently re-extracts clothing attributes from an image. Add an overload that accepts
already-extracted `ClothingAttributes` so the drawer skips the redundant vision step entirely.

### Bounding boxes use normalized coordinates

Store bounding boxes as normalized 0–1 floats so hotspots remain correctly positioned regardless
of image size.

Ask the vision model for approximate bounding boxes in the same response. Pixel-perfect precision
is unnecessary—a hotspot only needs to land on the garment.

### Poster links are untrusted input

`source_url` is user-supplied.

Validate:

- `https:` only
- render using `rel="noopener noreferrer nofollow"`
- display only the hostname instead of the raw URL so a malicious link cannot visually impersonate another domain

This is non-negotiable.

## User experience

### Posting

1. User uploads an OOTD photo.
2. Mila analyzes the outfit.
3. Detected clothing items appear in a confirmation sheet.
4. User may:
   - rename items
   - remove incorrect detections
   - optionally paste where each item came from
5. The post is published regardless of whether tagging is completed.

### Viewing

When another user opens the post:

- clothing hotspots appear on the image
- tapping a hotspot opens a drawer containing:
  - the clothing label
  - the original source link (if provided by the poster)
  - visually similar items ranked by similarity

## Rough sequencing

1. `post_items` migration + RLS (readable with the post, writable by the post owner).
2. `analyzeOutfitItems` server function — multi-item detection + bounding boxes. Test with fixture images.
3. Integrate into the posting flow (`feed.tsx` → `handleSubmit`) after upload and before (or alongside) `createPost`.
   - Detection failure should never prevent the post from publishing.
   - Publish first, tagging second if necessary.
4. Build the poster tagging sheet.
5. Add hotspots and the similar-items drawer to `PostCanvas`.
6. Add a `findDupes` overload that accepts existing `ClothingAttributes` and connect it to the drawer.

Steps 1–3 establish the data model and detection pipeline; Steps 4–6 build the user-facing experience.

## Open questions

- Should outfit detection consume AI credits, or should it be free to encourage more users to tag their outfits?
- What should happen when no sufficiently similar items are found?
  - An empty drawer creates a poor experience.
  - Consider rendering hotspots only for garments with at least one match above a minimum similarity threshold.
- Should posters be able to manually add clothing items that the AI misses?
- Should viewers be able to report incorrect detections to improve future recognition?
