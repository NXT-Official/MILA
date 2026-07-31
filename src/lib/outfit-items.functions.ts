import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { aiChatCompletion, aiFailure } from "./ai.server";
import { consumeRateLimit } from "./rate-limit.server";
import { withAiCredit } from "./credits.server";
import {
  CLOTHING_CATEGORIES as CATEGORIES,
  CLOTHING_UNDERTONES as UNDERTONES,
} from "@/constants/wardrobe";
import {
  MAX_DETECTED_ITEMS,
  normalizeSourceUrl,
  parseDetectedItems,
  type BBox,
  type ClothingAttributes,
  type PostItem,
} from "./outfit-items";

// The provider fetches the image immediately (see ai.server), so this only has to
// outlive one request.
const DETECTION_URL_TTL = 120;

const tool = {
  function: {
    name: "report_outfit_items",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: MAX_DETECTED_ITEMS,
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "A short, human-friendly product-style name for this one piece, e.g. 'Black cropped blazer'. Max 6 words.",
              },
              category: { type: "string", enum: CATEGORIES as unknown as string[] },
              primary_color: {
                type: "string",
                description: "The single dominant color of this garment, e.g. 'Navy', 'Cream'.",
              },
              color_undertone: { type: "string", enum: UNDERTONES as unknown as string[] },
              silhouette_tags: {
                type: "array",
                minItems: 2,
                maxItems: 3,
                items: { type: "string" },
                description:
                  "2-3 lowercase design-element tags, e.g. 'high-waisted', 'A-line', 'oversized'.",
              },
              bbox: {
                type: "object",
                description:
                  "Approximate box around this garment, as fractions of the image between 0 and 1: x/y are the top-left corner, w/h the size. Approximate is fine — it only positions a tap target.",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  w: { type: "number" },
                  h: { type: "number" },
                },
                required: ["x", "y", "w", "h"],
                additionalProperties: false,
              },
            },
            required: [
              "name",
              "category",
              "primary_color",
              "color_undertone",
              "silhouette_tags",
              "bbox",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
};

type PostItemRow = {
  id: string;
  label: string;
  category: string;
  attributes: Json;
  bbox: Json;
  source_url: string | null;
};

export function toPostItem(row: PostItemRow): PostItem {
  return {
    id: row.id,
    label: row.label,
    category: row.category,
    attributes: row.attributes as unknown as ClothingAttributes,
    bbox: row.bbox as unknown as BBox,
    source_url: row.source_url,
  };
}

const ITEM_COLUMNS = "id,label,category,attributes,bbox,source_url";

/**
 * Items for a set of posts, keyed by post id. RLS makes this visible exactly
 * when the post itself is, so both feed readers can share it.
 */
export async function loadPostItems(
  supabase: SupabaseClient<Database>,
  postIds: string[],
): Promise<Map<string, PostItem[]>> {
  const byPost = new Map<string, PostItem[]>();
  if (!postIds.length) return byPost;

  const { data, error } = await supabase
    .from("post_items")
    .select(`post_id,${ITEM_COLUMNS}`)
    .in("post_id", postIds)
    .order("created_at", { ascending: true });
  if (error) {
    // Tags are an enhancement; a feed without them still reads fine.
    console.error("[loadPostItems] failed", error.message);
    return byPost;
  }

  for (const row of data ?? []) {
    const list = byPost.get(row.post_id) ?? [];
    list.push(toPostItem(row));
    byPost.set(row.post_id, list);
  }
  return byPost;
}

const UpdatePostItemsInput = z.object({
  post_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        label: z.string().trim().min(1).max(100),
        source_url: z.string().max(2048).nullable(),
      }),
    )
    .max(MAX_DETECTED_ITEMS),
});

/**
 * Saves the poster's edits: renamed labels, where each piece is from, and the
 * removal of anything the model got wrong. Items missing from the list are
 * deleted, so an empty list clears every tag on the post.
 */
export const updatePostItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdatePostItemsInput.parse(input))
  .handler(async ({ data, context }): Promise<PostItem[]> => {
    const { supabase, userId } = context;

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id")
      .eq("id", data.post_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (postError) throw new Error(postError.message);
    if (!post) throw new Error("Post not found.");

    // Poster links are untrusted. Anything that isn't https is refused rather
    // than quietly dropped, so a typo doesn't look like it saved.
    const items = data.items.map((item) => {
      const raw = item.source_url?.trim();
      const url = raw ? normalizeSourceUrl(raw) : null;
      if (raw && !url) throw new Error(`"${raw}" isn't a valid https link.`);
      return { ...item, source_url: url };
    });

    const keptIds = items.map((item) => item.id);
    let removals = supabase.from("post_items").delete().eq("post_id", data.post_id);
    if (keptIds.length) removals = removals.not("id", "in", `(${keptIds.join(",")})`);
    const { error: deleteError } = await removals;
    if (deleteError) throw new Error(deleteError.message);

    // At most MAX_DETECTED_ITEMS rows, each with different values — not worth a
    // bulk-upsert dance that would need every NOT NULL column resent.
    const updates = await Promise.all(
      items.map((item) =>
        supabase
          .from("post_items")
          .update({ label: item.label, source_url: item.source_url })
          .eq("id", item.id)
          .eq("post_id", data.post_id)
          .select(ITEM_COLUMNS)
          .maybeSingle(),
      ),
    );
    const failed = updates.find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);

    return updates.flatMap((result) => (result.data ? [toPostItem(result.data)] : []));
  });

/**
 * One vision call per post, not per garment: N calls would be N times the latency
 * and N times the credit spend for the same photo.
 */
export const analyzeOutfitItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ post_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PostItem[]> => {
    const { supabase, userId } = context;

    // Only the poster may spend a credit tagging a post, and reading the image
    // path here means no client-supplied URL ever reaches the vision provider.
    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("image_url_back")
      .eq("id", data.post_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (postError) throw new Error(postError.message);
    if (!post) throw new Error("Post not found.");

    await consumeRateLimit(`ai:analyzeOutfitItems:${userId}`, { limit: 10, windowSeconds: 3600 });

    const signed = await supabase.storage
      .from("posts")
      .createSignedUrl(post.image_url_back, DETECTION_URL_TTL);
    if (signed.error || !signed.data?.signedUrl) throw new Error("Couldn't read the outfit photo.");

    const detected = await withAiCredit(
      supabase,
      userId,
      async () => {
        const result = await aiChatCompletion(
          [
            {
              role: "system",
              content:
                "You are Mila — an elite fashion archivist with the eye of a couturier. Identify every distinct clothing item worn in the photo (top, bottom, outerwear, shoes, bags, jewellery) and describe each one separately. Skip anything you cannot actually see. Always call the report_outfit_items tool. Pick each category from the allowed list with matching capitalization. Each primary_color must be a single common color word and each color_undertone must be Cool, Warm, or Neutral.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Catalogue every piece in this outfit." },
                { type: "image_url", image_url: { url: signed.data.signedUrl } },
              ],
            },
          ],
          tool,
        );
        if (!result.ok) throw aiFailure(result.status, "Outfit detection failed.");

        return parseDetectedItems((result.args as { items?: unknown }).items);
      },
      // Nothing recognised means nothing to tag — don't charge for that.
      { refundIf: (items) => items.length === 0 },
    );

    if (!detected.length) return [];

    // Re-running detection replaces the previous pass rather than stacking onto it.
    await supabase.from("post_items").delete().eq("post_id", data.post_id);

    const { data: rows, error: insertError } = await supabase
      .from("post_items")
      .insert(
        detected.map((item) => ({
          post_id: data.post_id,
          label: item.label,
          category: item.category,
          attributes: item.attributes as unknown as Json,
          bbox: item.bbox as unknown as Json,
        })),
      )
      .select(ITEM_COLUMNS);
    if (insertError) throw new Error(insertError.message);

    return (rows ?? []).map(toPostItem);
  });
