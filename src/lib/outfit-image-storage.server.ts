import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DATA_URI_PATTERN = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export async function uploadGeneratedOutfitImage({
  supabase,
  userId,
  imageDataUri,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  imageDataUri: string;
}): Promise<{ publicUrl: string; storagePath: string }> {
  const match = DATA_URI_PATTERN.exec(imageDataUri.trim());
  if (!match) throw new Error("Unsupported or malformed image data.");

  const [, format, base64] = match;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) throw new Error("The generated image was empty.");
  if (buffer.length > MAX_IMAGE_BYTES)
    throw new Error("The generated image was too large to save.");

  const storagePath = `${userId}/${crypto.randomUUID()}.${format === "jpeg" ? "jpg" : format}`;
  const { error } = await supabase.storage.from("outfits").upload(storagePath, buffer, {
    contentType: `image/${format}`,
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

export async function deleteOutfitImage(
  supabase: SupabaseClient<Database>,
  storagePath: string,
): Promise<void> {
  const { error } = await supabase.storage.from("outfits").remove([storagePath]);
  if (error) console.error("[deleteOutfitImage] cleanup failed:", error.message);
}
