const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.85;

/** What a member sees when the browser can't open the file they picked. */
export const UNREADABLE_PHOTO_MESSAGE = "We couldn't open that photo. Please choose a JPEG or PNG.";

/** Scale so the longest edge is at most `maxEdge`; never upscales. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** `IMG_0042.HEIC` -> `IMG_0042.jpg`; only the last extension is replaced. */
export function jpegFilename(name: string): string {
  const base = name.replace(/\.[^./\\]*$/, "");
  return `${base || "photo"}.jpg`;
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

async function decodeWithBitmap(file: File): Promise<DecodedImage> {
  // src: https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap · web platform · 2026-10-06
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: () => bitmap.close(),
  };
}

function decodeWithImageElement(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const release = () => URL.revokeObjectURL(url);
    img.onload = () =>
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, release });
    img.onerror = () => {
      release();
      reject(new Error("The image could not be decoded."));
    };
    img.src = url;
  });
}

async function decode(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    // Some older browsers reject the options bag; the image element still decodes there.
    const viaBitmap = await decodeWithBitmap(file).catch(() => null);
    if (viaBitmap) return viaBitmap;
  }
  return decodeWithImageElement(file);
}

/**
 * Re-encodes a picked photo as a JPEG no larger than `maxEdge` on its longest
 * side, upright, so it fits under the upload size limit and every downstream
 * decoder (face match only reads JPEG). Throws a member-friendly Error when
 * the browser can't open the file.
 */
export async function prepareImageForUpload(
  file: File,
  opts?: { maxEdge?: number; quality?: number },
): Promise<File> {
  const maxEdge = opts?.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts?.quality ?? DEFAULT_QUALITY;

  let decoded: DecodedImage;
  try {
    decoded = await decode(file);
  } catch {
    throw new Error(UNREADABLE_PHOTO_MESSAGE);
  }

  let blob: Blob | null;
  try {
    if (!(decoded.width > 0 && decoded.height > 0)) throw new Error(UNREADABLE_PHOTO_MESSAGE);
    const { width, height } = fitWithin(decoded.width, decoded.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(UNREADABLE_PHOTO_MESSAGE);
    // JPEG has no alpha: paint white first so a transparent PNG doesn't go black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, width, height);
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
  } finally {
    decoded.release();
  }

  if (!blob) throw new Error(UNREADABLE_PHOTO_MESSAGE);
  return new File([blob], jpegFilename(file.name), {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}
