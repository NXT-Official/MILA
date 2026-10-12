import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/utils";
import { createPost } from "./posts.functions";
import { analyzeOutfitItems, type AnalyzeOutfitItemsInputData } from "./outfit-items.functions";
import type { PostItem } from "./outfit-items";

/**
 * How long a detection call is waited for. A server job runs up to 300 s, so a
 * call that ends here is a lost answer, not a failure: the job row decides.
 */
export const OOTD_DETECTION_TIMEOUT_MS = 150_000;

type DetectCall = (args: { data: AnalyzeOutfitItemsInputData }) => Promise<PostItem[]>;

/**
 * One detection call for a post, keyed by `clientRequestId` so a retry of the
 * same press is replayed by the server instead of charged again. Gives up
 * waiting after OOTD_DETECTION_TIMEOUT_MS (a TimeoutError).
 */
export function detectOotdItems(
  postId: string,
  clientRequestId: string,
  options: { call?: DetectCall; timeoutMs?: number } = {},
): Promise<PostItem[]> {
  const call: DetectCall = options.call ?? ((args) => analyzeOutfitItems(args));
  return withTimeout(
    call({ data: { post_id: postId, clientRequestId } }),
    options.timeoutMs ?? OOTD_DETECTION_TIMEOUT_MS,
  );
}

type PublishDeps = {
  upload: (path: string, file: File) => Promise<{ error: { message: string } | null }>;
  createPost: (args: {
    data: { image_path_back: string; image_path_front: string; caption: string | null };
  }) => Promise<{ id: string }>;
  detect: (postId: string) => Promise<PostItem[]>;
};

const defaultDeps: PublishDeps = {
  upload: (path, file) =>
    supabase.storage.from("posts").upload(path, file, {
      contentType: "image/jpeg",
      upsert: false,
    }),
  createPost: (args) => createPost(args),
  // Existing callers now send a clientRequestId (a retry is idempotent) and wait at most
  // OOTD_DETECTION_TIMEOUT_MS; before, no id was sent and the wait was unbounded.
  // Inline detection has no press key to keep; its id lives for this one call.
  detect: (postId) => detectOotdItems(postId, crypto.randomUUID()),
};

/**
 * Uploads both captures, publishes the post, then (unless `detect` is false)
 * detects the garments in it.
 *
 * Inline detection runs after the insert and never rethrows: a vision hiccup or
 * an exhausted credit balance must not cost the poster their OOTD. A post with no
 * items simply has no hotspots.
 *
 * `detect: false` answers `{ postId, items: [] }` as soon as the post exists, so
 * "Posting..." ends in seconds. The caller then starts detection itself
 * (useOotdDetection), which survives her leaving the page.
 */
export async function publishOotd(
  {
    userId,
    back,
    front,
    caption,
    detect = true,
  }: {
    userId: string;
    back: File;
    front: File;
    caption: string;
    detect?: boolean;
  },
  deps: PublishDeps = defaultDeps,
): Promise<{ postId: string; items: PostItem[] }> {
  const stamp = Date.now();
  const backPath = `${userId}/back-${stamp}.jpg`;
  const frontPath = `${userId}/front-${stamp}.jpg`;

  const [{ error: backError }, { error: frontError }] = await Promise.all([
    deps.upload(backPath, back),
    deps.upload(frontPath, front),
  ]);
  if (backError || frontError) {
    throw new Error(backError?.message || frontError?.message || "Upload failed");
  }

  const { id: postId } = await deps.createPost({
    data: {
      image_path_back: backPath,
      image_path_front: frontPath,
      caption: caption || null,
    },
  });

  if (!detect) return { postId, items: [] };

  let items: PostItem[] = [];
  try {
    items = await deps.detect(postId);
  } catch (error) {
    console.error("[publishOotd] outfit detection failed", error);
  }

  return { postId, items };
}
