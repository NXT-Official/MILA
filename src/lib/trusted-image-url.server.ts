function storagePrefix(): string {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("Server is not configured to validate image sources.");
  return `${base}/storage/v1/object/public/`;
}

export function assertTrustedStorageImageUrl(url: string): string {
  const prefix = storagePrefix();
  if (!url.startsWith(prefix) || !url.startsWith("https://")) {
    throw new Error("Image must be uploaded to Mila's storage before analysis.");
  }
  return url;
}
