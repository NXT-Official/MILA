import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { aiChatCompletion } from "@/lib/ai.server";
import { consumeRateLimit } from "@/lib/rate-limit.server";
import { withAiCredit } from "@/lib/credits.server";
import {
  GENERATION_DEADLINE_SECONDS,
  resolveDailyAllowance,
  withGenerationJob,
  type GenerationJobContext,
  type GenerationJobDeps,
  type GenerationJobRunning,
} from "@/lib/generation-jobs.server";
import {
  CLOTHING_CATEGORIES as CATEGORIES,
  CLOTHING_UNDERTONES as UNDERTONES,
} from "@/constants/wardrobe";
import {
  MAX_DETECTED_ITEMS,
  parseDetectedItems,
  type DetectedItem,
  type PostItem,
} from "@/lib/outfit-items";
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

export type ItemsDeps = {
  /** The provider chat call: tests inject fakes; production uses aiChatCompletion. */
  ai?: typeof aiChatCompletion;
  /** The legacy credit wrapper, used only while the generation_jobs migration
   * is not applied. */
  withCredit?: typeof withAiCredit;
  jobs?: GenerationJobDeps;
  dailyAllowance?: (supabase: MilaSupabaseClient, userId: string) => Promise<number>;
  rateLimit?: (key: string) => Promise<unknown>;
  /** The service-role client the tags are written with after the AI call. */
  admin?: () => Promise<MilaSupabaseClient>;
};

async function serviceRoleClient(): Promise<MilaSupabaseClient> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/**
 * Replaces a post's tags without ever leaving her with fewer than she had: the
 * old rows' ids are read, the new rows inserted, and only then are the old ids
 * deleted. If the insert fails nothing is deleted; if the delete of the old ids
 * fails, the NEW rows are removed again so she keeps exactly her old set (and the
 * caller's job fails and refunds).
 *
 * Used with the service role (the write runs after the AI call, when the
 * member's request may be gone), which bypasses RLS, so it is scoped by
 * construction: the only post it can reach is `postId`, every statement carries
 * `post_id = <that post>`, and that post is re-read as hers (`user_id = userId`)
 * before anything is written. A foreign or missing post is refused with nothing
 * touched.
 */
export async function replacePostItems(
  db: MilaSupabaseClient,
  args: { userId: string; postId: string; items: DetectedItem[] },
): Promise<PostItem[]> {
  const { data: owned, error: ownerError } = await db
    .from("posts")
    .select("id")
    .eq("id", args.postId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (ownerError) throw new Error(ownerError.message);
  if (!owned) throw new DomainValidationError("Post not found.");

  const { data: oldRows, error: readError } = await db
    .from("post_items")
    .select("id")
    .eq("post_id", owned.id);
  if (readError) throw new Error(readError.message);
  const oldIds = (oldRows ?? []).map((row) => row.id);

  const { data: rows, error: insertError } = await db
    .from("post_items")
    .insert(
      args.items.map((item) => ({
        post_id: owned.id,
        label: item.label,
        category: item.category,
        attributes: item.attributes as unknown as Json,
        bbox: item.bbox as unknown as Json,
      })),
    )
    .select(ITEM_COLUMNS);
  if (insertError) throw new Error(insertError.message);
  const inserted = rows ?? [];

  if (oldIds.length) {
    const { error: deleteError } = await db
      .from("post_items")
      .delete()
      .eq("post_id", owned.id)
      .in("id", oldIds);
    if (deleteError) {
      const newIds = inserted.map((row) => row.id);
      if (newIds.length) {
        const { error: cleanupError } = await db
          .from("post_items")
          .delete()
          .eq("post_id", owned.id)
          .in("id", newIds);
        if (cleanupError) {
          console.error("[analyzeOutfitItems] could not remove the new tags", cleanupError.message);
        }
      }
      throw new Error(deleteError.message);
    }
  }

  return inserted.map(toPostItem);
}

/** A replayed answer: the stored items, checked before they are trusted. */
function itemsFromStored(result: Json | null): PostItem[] {
  const items =
    result && typeof result === "object" && !Array.isArray(result) ? result.items : undefined;
  if (!Array.isArray(items)) {
    console.error("[analyzeOutfitItems] a stored result no longer validates");
    throw new AiUnavailableError("Outfit detection failed.");
  }
  return items as unknown as PostItem[];
}

/**
 * Detects and catalogues every garment in a post's back-capture photo. **1 AI
 * credit, refunded if nothing is detected**, 10/hour. Shared verbatim by the
 * web `analyzeOutfitItems` server function and the mobile
 * `POST /api/v1/items/analyze` route.
 *
 * Runs as a generation job: one charge per `clientRequestId`, the tags written
 * to `post_items` (service role, scoped to the verified post) before the job
 * completes and she is answered, one refund on zero items or any failure. While
 * the migration is not applied this is the old `withAiCredit` path. The answer
 * stays a `PostItem[]`; `inFlight: 'report'` answers `{ status: 'running',
 * jobId }` while another request of this kind is being produced.
 *
 * No image URL crosses the wire in either direction: the server reads the
 * back image's storage path off the post row and mints its own short-lived
 * signed URL, so there is no client-supplied URL a server-side fetch could be
 * pointed at.
 */
export function analyzeOutfitItemsForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: AnalyzeOutfitItemsInputData,
  options?: { inFlight?: "attach" },
  deps?: ItemsDeps,
): Promise<PostItem[]>;
export function analyzeOutfitItemsForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: AnalyzeOutfitItemsInputData,
  options: { inFlight: "report" },
  deps?: ItemsDeps,
): Promise<PostItem[] | GenerationJobRunning>;
export async function analyzeOutfitItemsForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: AnalyzeOutfitItemsInputData,
  options: { inFlight?: "attach" | "report" } = {},
  deps: ItemsDeps = {},
): Promise<PostItem[] | GenerationJobRunning> {
  const ai = deps.ai ?? aiChatCompletion;
  const withCredit = deps.withCredit ?? withAiCredit;
  const dailyAllowanceFor = deps.dailyAllowance ?? resolveDailyAllowance;
  const rateLimit =
    deps.rateLimit ?? ((key: string) => consumeRateLimit(key, { limit: 10, windowSeconds: 3600 }));
  const adminClient = deps.admin ?? serviceRoleClient;

  // Only the poster may spend a credit tagging a post, and reading the image
  // path here means no client-supplied URL ever reaches the vision provider.
  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("id,image_url_back")
    .eq("id", data.post_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (postError) throw new Error(postError.message);
  if (!post) throw new DomainValidationError("Post not found.");

  await rateLimit(`ai:analyzeOutfitItems:${userId}`);

  const signed = await supabase.storage
    .from("posts")
    .createSignedUrl(post.image_url_back, DETECTION_URL_TTL);
  if (signed.error || !signed.data?.signedUrl) {
    throw new DomainValidationError("Couldn't read the outfit photo.");
  }
  const signedUrl = signed.data.signedUrl;

  const detect = async (): Promise<DetectedItem[]> => {
    const result = await ai(
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
            { type: "image_url", image_url: { url: signedUrl } },
          ],
        },
      ],
      tool,
      { supabase, userId },
    );
    if (!result.ok) throw new AiUnavailableError("Outfit detection failed.");

    return parseDetectedItems((result.args as { items?: unknown }).items);
  };

  const produce = async ({ stillRunning }: GenerationJobContext): Promise<PostItem[]> => {
    const detected = await detect();
    if (!detected.length) return [];
    // The deadline may have passed (job failed and refunded) while the provider
    // was answering: write nothing, her existing tags stay exactly as they are.
    if (!(await stillRunning())) return [];
    return replacePostItems(await adminClient(), {
      userId,
      postId: post.id,
      items: detected,
    });
  };

  // A request id belongs to one post: replaying it for another must not answer
  // the first post's tags. Refused before any charge.
  if (data.clientRequestId) {
    const { data: earlier, error: earlierError } = await (
      await adminClient()
    )
      .from("generation_jobs")
      .select("input")
      .eq("user_id", userId)
      .eq("client_request_id", data.clientRequestId)
      .maybeSingle();
    // A missing table (migration not applied) or a failed read is not a refusal:
    // the job path or the legacy path decides.
    const earlierPost =
      earlier?.input && typeof earlier.input === "object" && !Array.isArray(earlier.input)
        ? earlier.input.post_id
        : undefined;
    if (!earlierError && typeof earlierPost === "string" && earlierPost !== post.id) {
      throw new DomainValidationError("This request was already used for another post.");
    }
  }

  const outcome = await withGenerationJob<PostItem[]>(
    {
      kind: "item_detection",
      userId,
      clientRequestId: data.clientRequestId,
      input: { post_id: post.id },
      charge: true,
      dailyAllowance: await dailyAllowanceFor(supabase, userId),
      deadlineSeconds: GENERATION_DEADLINE_SECONDS,
      inFlight: options.inFlight,
      // Nothing recognised means nothing to tag: refunded, no result kept.
      settle: (items) =>
        items.length === 0
          ? { ok: false, errorCode: "no_items_found" }
          : { ok: true, result: { items } as unknown as Json },
      fromStored: ({ result }) => itemsFromStored(result),
      failure: (errorCode) => {
        if (errorCode === "no_items_found") return [];
        throw new AiUnavailableError("Outfit detection failed.");
      },
      // Today's exact sequence: detect under the credit (refunded on zero),
      // then the member-client write.
      legacy: async () => {
        const detected = await withCredit(supabase, userId, detect, {
          // Nothing recognised means nothing to tag — don't charge for that.
          refundIf: (items) => items.length === 0,
        });
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
      },
    },
    produce,
    deps.jobs,
  );
  return outcome.status === "running" ? outcome : outcome.value;
}
