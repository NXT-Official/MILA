import { describe, expect, test } from "bun:test";
import { notFound, redirect } from "@tanstack/react-router";
import type { LandingContent } from "./landing-content";
import { LANDING_FALLBACK } from "./landing-content.fallback";
import { loadLandingContentForRoute } from "./landing-content.route-loader";

/** Stands in for the Studio's published copy: distinguishable from the fallback. */
const PUBLISHED: LandingContent = {
  ...LANDING_FALLBACK,
  seo: { ...LANDING_FALLBACK.seo, title: "Published in the Studio" },
};

function rejectsWith(reason: unknown) {
  return async (): Promise<LandingContent> => {
    throw reason;
  };
}

describe("loadLandingContentForRoute", () => {
  test("resolves with the fetched content", async () => {
    expect(await loadLandingContentForRoute(async () => PUBLISHED)).toEqual(PUBLISHED);
  });

  test("a failed fetch resolves with the checked-in fallback", async () => {
    const offline = rejectsWith(new TypeError("Failed to fetch"));
    expect(await loadLandingContentForRoute(offline)).toEqual(LANDING_FALLBACK);
  });

  // The client fetcher resolves with the raw Response for a 200 that is not the
  // server function's reply (captive portal, proxy page) instead of rejecting.
  test("a reply that is not landing content resolves with the fallback", async () => {
    const portal = new Response("<html>Sign in to Wi-Fi</html>", {
      headers: { "content-type": "text/html" },
    });
    for (const reply of [portal, { message: "Bad gateway" }, null, undefined]) {
      const fetchContent = async () => reply as unknown as LandingContent;
      expect(await loadLandingContentForRoute(fetchContent)).toEqual(LANDING_FALLBACK);
    }
  });

  test("a redirect is re-thrown untouched", async () => {
    const signal = redirect({ to: "/login" });
    await expect(loadLandingContentForRoute(rejectsWith(signal))).rejects.toBe(signal);
  });

  test("a not-found is re-thrown untouched", async () => {
    const signal = notFound();
    await expect(loadLandingContentForRoute(rejectsWith(signal))).rejects.toBe(signal);
  });
});
