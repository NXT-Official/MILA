/**
 * Restricts images forwarded to the AI provider to Mila's own Supabase
 * Storage public objects.
 *
 * `analyzeOutfit`, `findDupes`, and `analyzeClothing` accept a client-supplied
 * `imageUrl` and embed it as an `image_url` content part in the chat-
 * completions request. Many OpenAI-compatible gateways (self-hosted
 * proxies/routers in particular) fetch that URL server-side to view the
 * image — an arbitrary URL there is an SSRF vector against the AI
 * provider's network (cloud metadata, internal services, etc.), not just a
 * content-type validation problem. Requiring the URL to be one of our own
 * public storage objects closes that off without needing a full outbound
 * SSRF-guarding fetch pipeline, since Mila's server never fetches the URL
 * itself — only the storage-hosted image ever leaves as a URL reference.
 */
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
