import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const DATA_URI_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

function parseImageDataUri(dataUri: string): { mimeType: string; ext: string; buffer: Buffer } {
  const match = DATA_URI_PATTERN.exec(dataUri.trim());
  if (!match) {
    throw new Error("Unsupported or malformed image data.");
  }
  const [, mimeType, base64] = match;
  const ext = ALLOWED_MIME_EXT[mimeType];
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    throw new Error("Unsupported or malformed image data.");
  }
  if (buffer.length === 0) {
    throw new Error("The generated image was empty.");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("The generated image was too large to save.");
  }
  return { mimeType, ext, buffer };
}

/**
 * Uploads a generated outfit image (a `data:image/...;base64,...` URI) to
 * the existing `outfits` storage bucket and returns its permanent public
 * URL. The storage path is always `${userId}/${uuid}.${ext}` — `userId`
 * must come from the verified session (context.userId), never from client
 * input, since the bucket's RLS policies scope reads/writes to that folder.
 */
export async function uploadGeneratedOutfitImage({
  supabase,
  userId,
  imageDataUri,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  imageDataUri: string;
}): Promise<{ publicUrl: string; storagePath: string }> {
  const { mimeType, ext, buffer } = parseImageDataUri(imageDataUri);
  const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from("outfits").upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) {
    console.error("[uploadGeneratedOutfitImage] upload failed:", error.message);
    throw new Error("The look could not be saved. Please try again.");
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("outfits").getPublicUrl(storagePath);
  return { publicUrl, storagePath };
}

/** Best-effort cleanup for an uploaded image whose DB insert then failed. */
export async function deleteOutfitImage(
  supabase: SupabaseClient<Database>,
  storagePath: string,
): Promise<void> {
  const { error } = await supabase.storage.from("outfits").remove([storagePath]);
  if (error) {
    console.error("[deleteOutfitImage] cleanup failed:", error.message);
  }
}
