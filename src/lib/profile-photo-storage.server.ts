import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DATA_URI_PATTERN = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const SIGNED_URL_TTL_SECONDS = 300;

export async function uploadProfilePhoto({
  supabase,
  userId,
  imageDataUri,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  imageDataUri: string;
}): Promise<{ storagePath: string }> {
  const match = DATA_URI_PATTERN.exec(imageDataUri.trim());
  if (!match) throw new Error("Unsupported or malformed image data.");

  const [, format, base64] = match;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) throw new Error("The photo was empty.");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("The photo was too large to save.");

  const storagePath = `${userId}/${crypto.randomUUID()}.${format === "jpeg" ? "jpg" : format}`;
  const { error } = await supabase.storage.from("profile-photos").upload(storagePath, buffer, {
    contentType: `image/${format}`,
    upsert: false,
  });
  if (error) {
    console.error("[uploadProfilePhoto] upload failed:", error.message);
    throw new Error("The photo could not be saved. Please try again.");
  }

  return { storagePath };
}

export async function deleteProfilePhoto(
  supabase: SupabaseClient<Database>,
  storagePath: string,
): Promise<void> {
  const { error } = await supabase.storage.from("profile-photos").remove([storagePath]);
  if (error) console.error("[deleteProfilePhoto] cleanup failed:", error.message);
}

export async function getSignedProfilePhotoUrl(
  supabase: SupabaseClient<Database>,
  storagePath: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from("profile-photos")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error("[getSignedProfilePhotoUrl] signing failed:", error?.message);
    throw new Error("The photo could not be loaded. Please try again.");
  }
  return data.signedUrl;
}
