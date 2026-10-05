import { isNotFound, isRedirect } from "@tanstack/react-router";
import type { LandingContent } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { getLandingContent } from "@/lib/landing-content.functions";

/** Top-level groups only, read off the fallback so the check can't drift from the type. */
function isLandingContent(value: unknown): value is LandingContent {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(LANDING_FALLBACK).every((group) => group in value)
  );
}

/**
 * Route loader for the landing page and the marketing subpages.
 *
 * On the server `getLandingContent` never throws, but on client-side
 * navigation it is a network call. When that fails (offline, flaky
 * connection) the router would show the root error page, although the
 * fallback copy is already in the client bundle. Render that instead.
 */
export async function loadLandingContentForRoute(
  fetchContent: () => Promise<LandingContent> = getLandingContent,
): Promise<LandingContent> {
  try {
    const content: unknown = await fetchContent();
    // A 200 that is not the server function's reply (captive portal, proxy
    // page) resolves with the raw Response rather than rejecting.
    // src: https://github.com/TanStack/router/blob/main/packages/start-client-core/src/client-rpc/serverFnFetcher.ts · @tanstack/start-client-core 1.170.34 · 2026-10-05
    return isLandingContent(content) ? content : LANDING_FALLBACK;
  } catch (error) {
    // Redirects and not-founds are the router's control flow, not failures.
    // src: https://tanstack.com/router/latest/docs/framework/react/api/router/isRedirectFunction · @tanstack/react-router 1.170.41 · 2026-10-05
    // src: https://tanstack.com/router/latest/docs/framework/react/api/router/isNotFoundFunction · @tanstack/react-router 1.170.41 · 2026-10-05
    if (isRedirect(error) || isNotFound(error)) throw error;
    return LANDING_FALLBACK;
  }
}
