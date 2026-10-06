import posthog from "posthog-js";

// Optional: like Sentry, local dev and any deployment without a configured
// PostHog project must keep working with this unset. Do not use requireEnv
// here. The project key is write-only and safe to ship in the client bundle
// (VITE_ prefix, public by design).
const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://us.i.posthog.com";

// Guard against re-initializing on every module re-evaluation (e.g. HMR) and
// against running on the server, where __root.tsx is also imported for SSR.
export const posthogEnabled = Boolean(key) && typeof window !== "undefined";

if (posthogEnabled && key) {
  posthog.init(key, {
    api_host: host,
    // Pageviews are captured explicitly from the root route so SPA navigation
    // and the initial load are measured identically.
    capture_pageview: false,
    capture_pageleave: true,
    // Members are identified in AuthProvider; visitors stay anonymous until
    // they sign in.
    person_profiles: "identified_only",
    loaded: (ph) => {
      if (import.meta.env.DEV) ph.debug();
    },
  });
  // Super properties: every event (pageviews, mirrors, autocapture) is
  // attributable to this app and build environment.
  posthog.register({ app: "mila-web", environment: import.meta.env.MODE });
}

/** Captures a product event. No-op when PostHog is unconfigured or on the server. */
export function capturePhEvent(event: string, properties?: Record<string, unknown>): void {
  if (!posthogEnabled) return;
  posthog.capture(event, properties ?? {});
}

/** Associates the browser session with a signed-in member. No-op when PostHog is unconfigured or on the server. */
export function identifyPhUser(userId: string): void {
  if (!posthogEnabled) return;
  posthog.identify(userId);
}

/** Clears the identified person on sign-out so the next visitor starts anonymous. Events captured before the reset keep their original distinct id. */
export function resetPh(): void {
  if (!posthogEnabled) return;
  posthog.reset();
}

/** Captures an SPA pageview for the given absolute URL. No-op when PostHog is unconfigured or on the server. */
export function capturePageview(url: string): void {
  if (!posthogEnabled) return;
  posthog.capture("$pageview", { $current_url: url });
}
