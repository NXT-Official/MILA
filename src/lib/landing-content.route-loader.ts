import { useLayoutEffect } from "react";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import type { LandingContent, LandingReply, LandingSource } from "@/lib/landing-content";
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

/** Every source, keyed so the check can't drift from the type. */
const SOURCES: Record<LandingSource, true> = { studio: true, "last-good": true, fallback: true };

/** The server function's reply: landing content and a source it names. */
function isLandingReply(value: unknown): value is LandingReply {
  if (typeof value !== "object" || value === null) return false;
  const { content, source } = value as { content?: unknown; source?: unknown };
  return isLandingContent(content) && typeof source === "string" && Object.hasOwn(SOURCES, source);
}

/** The part of the router's loader context a landing route uses. */
type LandingRouteContext = { route: { id: string } };

export type LandingRouteLoader = {
  /** The route `loader`: never throws a failed fetch, only redirects and not-founds. */
  loader: (context: LandingRouteContext) => Promise<LandingContent>;
  /** The route `shouldReload`: `true` after a load that served no fresh copy. */
  shouldReload: (context: LandingRouteContext) => true | undefined;
  /**
   * Remembers the copy the server rendered the page with. Ignored once this
   * browser has loaded landing content itself, and always on the server.
   */
  rememberServerRendered: (content: LandingContent) => void;
};

/**
 * Loader and reload rule for the landing page and the marketing subpages.
 *
 * On the server `getLandingContent` never throws, but on client-side
 * navigation and intent preloads it is a network call. When that fails
 * (offline, flaky connection) the router would show the root error page.
 * Instead the browser serves the landing copy it already has: the one the
 * server rendered the page with, then whatever a later fetch brought. Only
 * with neither does it serve the checked-in fallback, which knows nothing of
 * hidden sections or Studio edits. Such a load is not fresh, so the page is
 * fetched again on its next visit.
 *
 * A server instance that has never read Sanity replies with that same
 * checked-in copy while Sanity is down (`source: "fallback"`). When the
 * browser has a copy of its own, such a reply is a failed load too.
 *
 * Only a browser remembers. The server keeps its own last good copy
 * (`createLandingLoader`); state kept here would outlive the request.
 */
export function createLandingRouteLoader({
  inBrowser = typeof window !== "undefined",
  fetchContent = getLandingContent,
}: {
  inBrowser?: boolean;
  fetchContent?: () => Promise<LandingReply>;
} = {}): LandingRouteLoader {
  let remembered: LandingContent | null = null;
  // Until this browser's first load of its own, a page can only render the
  // copy the server rendered it with; after it, a page may render client-fetched
  // data older than `remembered`.
  let loadedOnce = false;
  // Routes whose last load served `remembered` or the fallback.
  const notFresh = new Set<string>();

  return {
    async loader({ route }) {
      if (inBrowser) loadedOnce = true;
      let reply: unknown;
      try {
        reply = await fetchContent();
      } catch (error) {
        // Redirects and not-founds are the router's control flow, not failures.
        // src: https://github.com/TanStack/router/blob/@tanstack/react-router@1.170.41/docs/router/api/router/isRedirectFunction.md · @tanstack/react-router 1.170.41 · 2026-10-05
        // src: https://github.com/TanStack/router/blob/@tanstack/react-router@1.170.41/docs/router/api/router/isNotFoundFunction.md · @tanstack/react-router 1.170.41 · 2026-10-05
        if (isRedirect(error) || isNotFound(error)) throw error;
      }
      // A 200 that is not the server function's reply (captive portal, proxy
      // page) resolves with the raw Response rather than rejecting.
      // src: https://github.com/TanStack/router/blob/@tanstack/start-client-core@1.170.34/packages/start-client-core/src/client-rpc/serverFnFetcher.ts · @tanstack/start-client-core 1.170.34 · 2026-10-05
      //
      // A `fallback` reply is the checked-in copy of an instance that has never
      // read Sanity. Over a copy this browser already has it would bring back
      // what an editor hid, so it counts as a failed load. Only a browser has a
      // copy; the server renders every reply.
      if (isLandingReply(reply) && (reply.source !== "fallback" || remembered === null)) {
        if (inBrowser) {
          remembered = reply.content;
          notFresh.delete(route.id);
        }
        return reply.content;
      }
      if (inBrowser) notFresh.add(route.id);
      return remembered ?? LANDING_FALLBACK;
    },

    // `true` reloads the page on its next visit even inside its staleTime;
    // `undefined`, unlike `false`, leaves the staleTime in charge otherwise.
    // `router.invalidate()` would instead reload the page on screen at once,
    // over and over while the visitor is offline.
    // src: https://github.com/TanStack/router/blob/@tanstack/react-router@1.170.41/docs/router/api/router/RouteOptionsType.md#shouldreload-property · @tanstack/react-router 1.170.41 · 2026-10-05
    shouldReload({ route }) {
      return notFresh.has(route.id) || undefined;
    },

    rememberServerRendered(content) {
      if (inBrowser && !loadedOnce) remembered = content;
    },
  };
}

const landingRoutes = createLandingRouteLoader();

/** `loader` of the landing page and the marketing subpages. */
export const loadLandingContentForRoute = landingRoutes.loader;

/** `shouldReload` of the landing page and the marketing subpages. */
export const shouldReloadLandingRoute = landingRoutes.shouldReload;

/**
 * Called by each landing route's component with its loader data, so the
 * browser remembers the copy the server rendered the page it landed on with.
 * A layout effect runs as the hydrated page commits, before any link on it
 * can start a preload, and never on the server.
 */
export function useRememberServerRendered(content: LandingContent): void {
  useLayoutEffect(() => {
    landingRoutes.rememberServerRendered(content);
  }, [content]);
}
