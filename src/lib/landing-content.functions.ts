import { createServerFn } from "@tanstack/react-start";
import type { LandingContent } from "@/lib/landing-content";
import { LANDING_QUERY, createLandingLoader } from "@/lib/landing-content.normalize";

// One loader per server instance: it remembers the last good content and
// when a failed read may be retried (see `createLandingLoader`).
const loadLandingContent = createLandingLoader();

/** The one call this module makes on the Sanity client. */
export type LandingDocumentClient = {
  fetch: (
    query: string,
    params: Record<string, never>,
    options: { signal: AbortSignal },
  ) => Promise<unknown>;
};

/**
 * Runs `LANDING_QUERY` for the loader. `client` defaults to the app's Sanity
 * client, imported on first use: it needs SANITY_* to be set, and a server
 * without them never reads.
 */
export async function fetchLandingDocument(
  signal: AbortSignal,
  client?: LandingDocumentClient,
): Promise<unknown> {
  const sanity: LandingDocumentClient = client ?? (await import("@/lib/sanity.server")).sanity;
  // Aborting the signal cancels the HTTP request and rejects with AbortError.
  // src: https://github.com/sanity-io/client/blob/v7.26.0/README.md#aborting-a-request · @sanity/client 7.26.0 · 2026-10-05
  return sanity.fetch(LANDING_QUERY, {}, { signal });
}

/**
 * Sends a landing failure to Sentry. Loaded on demand, like the Sanity client,
 * so it only costs a failure; never rejects.
 */
export function reportLandingFailure(
  error: unknown,
  sentry: () => Promise<{ captureServerException: (error: unknown) => void }> = () =>
    import("@/lib/sentry.server"),
): Promise<void> {
  return sentry()
    .then(({ captureServerException }) => captureServerException(error))
    .catch(() => {});
}

/**
 * Landing copy from the MILA Sanity Studio (`landingPage` singleton).
 * Never throws and never waits more than a few seconds. A Sanity outage, slow
 * read or unpublished document renders the last content this server read (or
 * the checked-in fallback, `landing-content.fallback.ts`, before any read has
 * succeeded), warns on the server and reports to Sentry. Missing env renders
 * the fallback, with one warning and one report per server instance. Before
 * 2026-10-04 it threw, which took the home page down.
 */
export const getLandingContent = createServerFn({ method: "GET" }).handler(
  async (): Promise<LandingContent> => {
    const projectId = process.env.SANITY_PROJECT_ID;
    const dataset = process.env.SANITY_DATASET;
    return loadLandingContent({
      target: projectId && dataset ? { projectId, dataset } : null,
      fetchDocument: (signal) => fetchLandingDocument(signal),
      warn: (...args) => console.warn(...args),
      report: (error) => void reportLandingFailure(error),
    });
  },
);
