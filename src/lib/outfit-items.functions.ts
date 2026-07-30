import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { aiChatCompletion } from "./ai.server";
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";
import { withAiCredit } from "./credits.server";
import {
  CLOTHING_CATEGORIES as CATEGORIES,
  CLOTHING_UNDERTONES as UNDERTONES,
} from "@/constants/wardrobe";
import {
  MAX_DETECTED_ITEMS,
  parseDetectedItems,
  type BBox,
  type ClothingAttributes,
  type PostItem,
} from "./outfit-items";

const ANALYZE_OUTFIT_LIMIT = 10;
const ANALYZE_OUTFIT_WINDOW_SECONDS = 60 * 60;
// The provider fetches the image immediately (see ai.server), so this only has to
// outlive one request.
const DETECTION_URL_TTL = 120;

const tool = {
  type: "function" as const,
  function: {
    name: "report_outfit_items",
    description: "Return every distinct clothing item worn in the photo.",
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

    try {
      await consumeRateLimit(
        `ai:analyzeOutfitItems:${userId}`,
        ANALYZE_OUTFIT_LIMIT,
        ANALYZE_OUTFIT_WINDOW_SECONDS,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }

    const signed = await supabase.storage
      .from("posts")
      .createSignedUrl(post.image_url_back, DETECTION_URL_TTL);
    if (signed.error || !signed.data?.signedUrl) throw new Error("Couldn't read the outfit photo.");

    const detected = await withAiCredit(
      supabase,
      userId,
      async () => {
        const res = await aiChatCompletion({
          messages: [
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
          tools: [tool],
          tool_choice: { type: "function", function: { name: "report_outfit_items" } },
        });

        if (res.status === 429)
          throw new Error("Rate limit reached. Please try again in a moment.");
        if (res.status === 402) throw new Error("AI credits exhausted. Please try again later.");
        if (!res.ok) {
          const body = await res.text();
          console.error("AI provider error", res.status, body);
          throw new Error("Outfit detection failed.");
        }

        const json = await res.json();
        const call = json.choices?.[0]?.message?.tool_calls?.[0];
        if (!call) throw new Error("AI did not return any items.");
        const raw = JSON.parse(call.function.arguments) as { items?: unknown };
        return parseDetectedItems(raw.items);
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
