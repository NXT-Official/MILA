import { createServerFn } from "@tanstack/react-start";

/**
 * Computed on the server and serialised with the router state, so the browser
 * never derives an origin of its own.
 * // src: https://github.com/TanStack/router/blob/@tanstack/react-router@1.170.41/docs/router/api/router/RouteOptionsType.md
 * //      (loader data is dehydrated to the client) · @tanstack/react-router 1.170.41 · 2026-10-07
 */
export const getSiteContext = createServerFn({ method: "GET" }).handler(async () =>
  (await import("./site-context.server")).readSiteContext(),
);
