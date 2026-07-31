export function isTrustedStorageImageUrl(url: string | null | undefined): url is string {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("Server is not configured to validate image sources.");
  return !!url && url.startsWith(`${base}/storage/v1/object/public/`);
}

export function assertTrustedStorageImageUrl(url: string): string {
  if (!isTrustedStorageImageUrl(url)) {
    throw new Error("Image must be uploaded to Mila's storage before analysis.");
  }
  return url;
}
