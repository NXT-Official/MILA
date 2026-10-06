import { UNREADABLE_PHOTO_MESSAGE, prepareImageForUpload } from "@/lib/prepare-image-for-upload";

/** What a photo picker accepts: the formats a phone camera roll hands over. */
export const PHOTO_PICKER_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

export type PickedPhoto = { ok: true; file: File } | { ok: false; message: string };

/**
 * Runs a photo the member picked through `prepareImageForUpload` (downscaled,
 * upright JPEG) and never throws: a photo the browser can't open comes back as
 * the friendly line to show. `prepare` is a parameter so tests need no canvas.
 */
export async function preparePickedPhoto(
  file: File,
  prepare: (file: File) => Promise<File> = prepareImageForUpload,
): Promise<PickedPhoto> {
  try {
    return { ok: true, file: await prepare(file) };
  } catch (error) {
    console.error("[photo] couldn't prepare the picked photo:", error);
    return { ok: false, message: UNREADABLE_PHOTO_MESSAGE };
  }
}
