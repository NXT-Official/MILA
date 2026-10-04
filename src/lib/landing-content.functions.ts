import { createServerFn } from "@tanstack/react-start";
import type { LandingContent } from "@/lib/landing-content";
import { LANDING_QUERY, loadLandingContent } from "@/lib/landing-content.normalize";

/**
 * Landing copy from the MILA Sanity Studio (`landingPage` singleton).
 * Never throws: a Sanity outage, missing env or unpublished document renders
 * the checked-in fallback (`landing-content.fallback.ts`) and logs a warning
 * on the server. Before 2026-10-04 it threw, which took the home page down.
 */
export const getLandingContent = createServerFn({ method: "GET" }).handler(
  async (): Promise<LandingContent> => {
    const projectId = process.env.SANITY_PROJECT_ID;
    const dataset = process.env.SANITY_DATASET;
    return loadLandingContent({
      target: projectId && dataset ? { projectId, dataset } : null,
      fetchDocument: async () => {
        const { sanity } = await import("@/lib/sanity.server");
        return sanity.fetch<unknown>(LANDING_QUERY);
      },
      warn: (...args) => console.warn(...args),
    });
  },
);
