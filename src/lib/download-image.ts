import { toast } from "sonner";

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

/** Saves an image to the user's device. Handles both base64 data URIs (AI-generated
 * visuals) and remote URLs (Supabase storage) — remote URLs are fetched into a blob
 * first so the browser downloads the file instead of just navigating to it. */
export async function downloadImage(src: string, filename: string) {
  try {
    if (src.startsWith("data:")) {
      triggerDownload(src, filename);
      return;
    }
    const res = await fetch(src);
    if (!res.ok) throw new Error("Image fetch failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    URL.revokeObjectURL(url);
  } catch {
    toast.error("Couldn't download the image. Please try again.");
  }
}
