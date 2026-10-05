import { createServerFn } from "@tanstack/react-start";
import type { LandingContent } from "@/lib/landing-content";
import { LANDING_QUERY, createLandingLoader } from "@/lib/landing-content.normalize";

// One loader per server instance: it remembers the last good content and
// when a failed read may be retried (see `createLandingLoader`).
const loadLandingContent = createLandingLoader();

/**
 * Landing copy from the MILA Sanity Studio (`landingPage` singleton).
 * Never throws and never waits more than a few seconds. A Sanity outage, slow
 * read or unpublished document renders the last content this server read (or
 * the checked-in fallback, `landing-content.fallback.ts`, before any read has
 * succeeded), warns on the server and reports to Sentry. Missing env renders
 * the fallback with a warning. Before 2026-10-04 it threw, which took the
 * home page down.
 */
export const getLandingContent = createServerFn({ method: "GET" }).handler(
  async (): Promise<LandingContent> => {
    const projectId = process.env.SANITY_PROJECT_ID;
    const dataset = process.env.SANITY_DATASET;
    return loadLandingContent({
      target: projectId && dataset ? { projectId, dataset } : null,
      fetchDocument: async (signal) => {
        const { sanity } = await import("@/lib/sanity.server");
        // Aborting the signal cancels the HTTP request and rejects with AbortError.
        // src: https://github.com/sanity-io/client/blob/v7.26.0/README.md#aborting-a-request · @sanity/client 7.26.0 · 2026-10-05
        return sanity.fetch<unknown>(LANDING_QUERY, {}, { signal });
      },
      warn: (...args) => console.warn(...args),
      report: (error) => {
        // Loaded on demand, like the Sanity client, so it only costs a failure.
        void import("@/lib/sentry.server")
          .then(({ captureServerException }) => captureServerException(error))
          .catch(() => {});
      },
    });
  },
);
