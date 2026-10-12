import { isNotFound, isRedirect } from "@tanstack/react-router";
import type { SiteContext } from "@/lib/site-seo";

/**
 * The root route's loader. It sits above every page, so a failure here must
 * not turn into the root error page: it answers `undefined` and every head()
 * falls back to the live defaults (`siteFromMatches`). In a browser a later
 * failure (offline "Try again", a 5xx) keeps the context already loaded.
 * Redirects and not-founds are the router's own control flow and pass through.
 * Nothing is remembered on the server, where one process serves many hosts.
 * // src: https://github.com/TanStack/router/blob/@tanstack/react-router@1.170.41/docs/router/api/router/isRedirectFunction.md · 1.170.41 · 2026-10-07
 * // src: https://github.com/TanStack/router/blob/@tanstack/react-router@1.170.41/docs/router/api/router/isNotFoundFunction.md · 1.170.41 · 2026-10-07
 */
export function createSiteContextLoader(
  fetchContext: () => Promise<SiteContext>,
  inBrowser: () => boolean = () => typeof window !== "undefined",
): () => Promise<SiteContext | undefined> {
  let lastGood: SiteContext | undefined;
  return async () => {
    try {
      const context = await fetchContext();
      if (inBrowser()) lastGood = context;
      return context;
    } catch (error) {
      if (isRedirect(error) || isNotFound(error)) throw error;
      return inBrowser() ? lastGood : undefined;
    }
  };
}
