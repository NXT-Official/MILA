import { supabase } from "@/integrations/supabase/client";
import { createPost } from "./posts.functions";
import { analyzeOutfitItems } from "./outfit-items.functions";
import type { PostItem } from "./outfit-items";

/**
 * Uploads both captures, publishes the post, then detects the garments in it.
 *
 * Detection runs after the insert and never rethrows: a vision hiccup or an
 * exhausted credit balance must not cost the poster their OOTD. A post with no
 * items simply has no hotspots.
 */
export async function publishOotd({
  userId,
  back,
  front,
  caption,
}: {
  userId: string;
  back: File;
  front: File;
  caption: string;
}): Promise<{ postId: string; items: PostItem[] }> {
  const stamp = Date.now();
  const backPath = `${userId}/back-${stamp}.jpg`;
  const frontPath = `${userId}/front-${stamp}.jpg`;

  const [{ error: backError }, { error: frontError }] = await Promise.all([
    supabase.storage.from("posts").upload(backPath, back, {
      contentType: "image/jpeg",
      upsert: false,
    }),
    supabase.storage.from("posts").upload(frontPath, front, {
      contentType: "image/jpeg",
      upsert: false,
    }),
  ]);
  if (backError || frontError) {
    throw new Error(backError?.message || frontError?.message || "Upload failed");
  }

  const { id: postId } = await createPost({
    data: {
      image_path_back: backPath,
      image_path_front: frontPath,
      caption: caption || null,
    },
  });

  let items: PostItem[] = [];
  try {
    items = await analyzeOutfitItems({ data: { post_id: postId } });
  } catch (error) {
    console.error("[publishOotd] outfit detection failed", error);
  }

  return { postId, items };
}
