import { getRequestUrl } from "@tanstack/react-start/server";
import { siteContext, type SiteContext } from "@/lib/site-seo";

/**
 * The site context for the request being served. The host is only compared to
 * the canonical host, never echoed into a tag, so a forged Host header can at
 * worst make a page noindex.
 * // src: node_modules/@tanstack/start-server-core/src/request-response.ts
 * //      (getRequestUrl) · 1.169.39, same call as auth-handler.server.ts
 */
export function readSiteContext(): SiteContext {
  return siteContext(getRequestUrl({ xForwardedHost: true }).host, process.env);
}
