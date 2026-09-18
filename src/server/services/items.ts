import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { aiChatCompletion } from "@/lib/ai.server";
import { consumeRateLimit } from "@/lib/rate-limit.server";
import { withAiCredit } from "@/lib/credits.server";
import {
  CLOTHING_CATEGORIES as CATEGORIES,
  CLOTHING_UNDERTONES as UNDERTONES,
} from "@/constants/wardrobe";
import { MAX_DETECTED_ITEMS, parseDetectedItems, type PostItem } from "@/lib/outfit-items";
import { toPostItem } from "@/lib/outfit-items.functions";
import { AiUnavailableError, DomainValidationError } from "@/server/http/api-errors";
import type { AnalyzeOutfitItemsInputData } from "@/lib/outfit-items.functions";

type MilaSupabaseClient = SupabaseClient<Database>;

const ITEM_COLUMNS = "id,label,category,attributes,bbox,source_url";

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

/**
 * Detects and catalogues every garment in a post's back-capture photo. **1 AI
 * credit, refunded if nothing is detected**, 10/hour. Shared verbatim by the
 * web `analyzeOutfitItems` server function and the mobile
 * `POST /api/v1/items/analyze` route.
 *
 * No image URL crosses the wire in either direction: the server reads the
 * back image's storage path off the post row and mints its own short-lived
 * signed URL, so there is no client-supplied URL a server-side fetch could be
 * pointed at.
 */
export async function analyzeOutfitItemsForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: AnalyzeOutfitItemsInputData,
): Promise<PostItem[]> {
  // Only the poster may spend a credit tagging a post, and reading the image
  // path here means no client-supplied URL ever reaches the vision provider.
  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("image_url_back")
    .eq("id", data.post_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (postError) throw new Error(postError.message);
  if (!post) throw new DomainValidationError("Post not found.");

  await consumeRateLimit(`ai:analyzeOutfitItems:${userId}`, { limit: 10, windowSeconds: 3600 });

  const signed = await supabase.storage
    .from("posts")
    .createSignedUrl(post.image_url_back, DETECTION_URL_TTL);
  if (signed.error || !signed.data?.signedUrl) {
    throw new DomainValidationError("Couldn't read the outfit photo.");
  }

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
        { supabase, userId },
      );
      if (!result.ok) throw new AiUnavailableError("Outfit detection failed.");

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
}
