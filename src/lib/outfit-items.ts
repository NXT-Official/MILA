import { z } from "zod";
import {
  CLOTHING_CATEGORIES as CATEGORIES,
  CLOTHING_UNDERTONES as UNDERTONES,
} from "@/constants/wardrobe";

export const ClothingAttributesSchema = z.object({
  name: z.string().max(100),
  category: z.enum(CATEGORIES),
  primary_color: z.string(),
  color_undertone: z.enum(UNDERTONES),
  silhouette_tags: z.array(z.string()),
});

export type ClothingAttributes = z.infer<typeof ClothingAttributesSchema>;

/** Normalized 0-1 rectangle, so a hotspot lands on the garment at any render size. */
export type BBox = { x: number; y: number; w: number; h: number };

export type DetectedItem = {
  label: string;
  category: string;
  attributes: ClothingAttributes;
  bbox: BBox;
};

export type PostItem = DetectedItem & { id: string; source_url: string | null };

/** An outfit is 3-6 pieces; the cap only exists to bound a runaway response. */
export const MAX_DETECTED_ITEMS = 8;

const DetectedItemSchema = ClothingAttributesSchema.extend({
  bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});

const clamp = (n: number) => Math.min(1, Math.max(0, n));
// Four decimals is a fraction of a pixel on any real photo, and it keeps float
// subtraction noise (0.7 - 0.3) out of the stored JSON.
const round = (n: number) => Math.round(n * 1e4) / 1e4;

// The schema asks for 0-1 floats, but vision models routinely answer on their own
// normalization scale (Gemini documents 0-1000). Without this every hotspot would
// clamp into the top-left corner, which looks like a detection bug rather than a
// units bug. ponytail: infer the scale from the magnitude — good enough while the
// only consumer is a tappable dot.
function rescale(bbox: BBox): BBox {
  const largest = Math.max(bbox.x + bbox.w, bbox.y + bbox.h);
  // 1.5 rather than 1: a fractional box may legitimately overrun the frame edge
  // by a little, and reading that as percent units would shrink it to nothing.
  const scale = largest <= 1.5 ? 1 : largest <= 100 ? 100 : 1000;
  return { x: bbox.x / scale, y: bbox.y / scale, w: bbox.w / scale, h: bbox.h / scale };
}

/**
 * Turns a raw multi-item vision response into storable items. One malformed
 * garment must not lose the whole outfit, so items are validated individually
 * and bad ones are dropped rather than thrown.
 */
export function parseDetectedItems(raw: unknown): DetectedItem[] {
  if (!Array.isArray(raw)) return [];

  const items: DetectedItem[] = [];
  for (const entry of raw) {
    const parsed = DetectedItemSchema.safeParse(entry);
    if (!parsed.success) continue;

    const label = parsed.data.name.trim();
    if (!label) continue;

    const scaled = rescale(parsed.data.bbox);
    const left = clamp(scaled.x);
    const top = clamp(scaled.y);
    const right = clamp(scaled.x + scaled.w);
    const bottom = clamp(scaled.y + scaled.h);
    if (right <= left || bottom <= top) continue;

    const { bbox: _raw, ...attributes } = parsed.data;
    items.push({
      label,
      category: attributes.category,
      attributes,
      bbox: { x: round(left), y: round(top), w: round(right - left), h: round(bottom - top) },
    });
    if (items.length === MAX_DETECTED_ITEMS) break;
  }
  return items;
}

/**
 * Poster-supplied links are untrusted: only https survives, and the caller shows
 * the hostname rather than the raw URL so a link cannot visually impersonate
 * another domain.
 */
export function normalizeSourceUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  return url.protocol === "https:" ? url.toString() : null;
}

export function sourceUrlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}
