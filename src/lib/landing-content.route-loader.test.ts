import { describe, expect, setSystemTime, test } from "bun:test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  redirect,
} from "@tanstack/react-router";
import type { LandingContent } from "./landing-content";
import { LANDING_FALLBACK } from "./landing-content.fallback";
import { createLandingRouteLoader } from "./landing-content.route-loader";

/** Stands in for the Studio's published copy: distinguishable from the fallback. */
const PUBLISHED: LandingContent = {
  ...LANDING_FALLBACK,
  seo: { ...LANDING_FALLBACK.seo, title: "Published in the Studio" },
};

/** What the server rendered the page with: an editor has hidden the testimonials. */
const SERVER_RENDERED: LandingContent = {
  ...LANDING_FALLBACK,
  testimonials: [],
  community: { ...LANDING_FALLBACK.community, hideTestimonials: true },
};

/** A later publish, fetched on a client-side navigation. */
const REPUBLISHED: LandingContent = {
  ...LANDING_FALLBACK,
  hero: { ...LANDING_FALLBACK.hero, headlineLine1: "Republished." },
};

type Fetch = () => Promise<LandingContent>;

const resolvesWith =
  (reply: unknown): Fetch =>
  async () =>
    reply as LandingContent;

function rejectsWith(reason: unknown): Fetch {
  return async () => {
    throw reason;
  };
}

const OFFLINE = rejectsWith(new TypeError("Failed to fetch"));

/**
 * The client fetcher resolves with the raw Response for a 200 that is not the
 * server function's reply (captive portal, proxy page) instead of rejecting.
 */
const PORTAL = resolvesWith(
  new Response("<html>Sign in to Wi-Fi</html>", { headers: { "content-type": "text/html" } }),
);

/** Every way a client fetch can fail to bring landing content back. */
const FAILURES: Record<string, Fetch> = {
  "a rejected fetch": OFFLINE,
  "a captive-portal page": PORTAL,
  "a JSON error body": resolvesWith({ message: "Bad gateway" }),
  null: resolvesWith(null),
  undefined: resolvesWith(undefined),
};

/** One loader whose next fetch the test scripts; counts the fetches it makes. */
function scripted(inBrowser: boolean) {
  let next: Fetch = async () => PUBLISHED;
  const seen = { fetches: 0 };
  const landing = createLandingRouteLoader({
    inBrowser,
    fetchContent: () => {
      seen.fetches += 1;
      return next();
    },
  });
  return {
    ...landing,
    seen,
    nextFetch(fetch: Fetch) {
      next = fetch;
    },
    /** What the route `id`'s loader resolves with. */
    load: (id = "/community") => landing.loader({ route: { id } }),
  };
}

for (const inBrowser of [true, false]) {
  describe(`landing route loader (${inBrowser ? "browser" : "server"})`, () => {
    test("resolves with the fetched content", async () => {
      const landing = scripted(inBrowser);
      expect(await landing.load()).toEqual(PUBLISHED);
    });

    test("a failed fetch with nothing remembered resolves with the checked-in fallback", async () => {
      for (const [name, failure] of Object.entries(FAILURES)) {
        const landing = scripted(inBrowser);
        landing.nextFetch(failure);
        expect([name, await landing.load()]).toEqual([name, LANDING_FALLBACK]);
      }
    });

    test("a redirect is re-thrown untouched", async () => {
      const landing = scripted(inBrowser);
      const signal = redirect({ to: "/login" });
      landing.nextFetch(rejectsWith(signal));
      await expect(landing.load()).rejects.toBe(signal);
    });

    test("a not-found is re-thrown untouched", async () => {
      const landing = scripted(inBrowser);
      const signal = notFound();
      landing.nextFetch(rejectsWith(signal));
      await expect(landing.load()).rejects.toBe(signal);
    });
  });
}

describe("landing route loader: the browser keeps the Studio copy it already has", () => {
  test("a failed fetch serves the copy the server rendered the page with", async () => {
    for (const [name, failure] of Object.entries(FAILURES)) {
      const landing = scripted(true);
      landing.rememberServerRendered(SERVER_RENDERED);
      landing.nextFetch(failure);
      const served = await landing.load();
      expect([name, served]).toEqual([name, SERVER_RENDERED]);
      expect([name, served.testimonials]).toEqual([name, []]);
    }
  });

  test("each good fetch replaces the remembered copy", async () => {
    const landing = scripted(true);
    landing.rememberServerRendered(SERVER_RENDERED);
    landing.nextFetch(resolvesWith(REPUBLISHED));
    expect(await landing.load("/how-it-works")).toEqual(REPUBLISHED);

    landing.nextFetch(OFFLINE);
    expect(await landing.load("/community")).toEqual(REPUBLISHED);
  });

  // Returning to the page the visitor landed on renders its older copy again;
  // that must not replace what a later fetch brought.
  test("only the server-rendered copy seeds the memory, never a copy rendered after the first fetch", async () => {
    const landing = scripted(true);
    landing.nextFetch(resolvesWith(REPUBLISHED));
    await landing.load("/how-it-works");
    landing.rememberServerRendered(SERVER_RENDERED);

    landing.nextFetch(OFFLINE);
    expect(await landing.load("/community")).toEqual(REPUBLISHED);
  });

  test("a failed first fetch leaves no copy for a later render to seed", async () => {
    const landing = scripted(true);
    landing.nextFetch(OFFLINE);
    expect(await landing.load()).toEqual(LANDING_FALLBACK);
    landing.rememberServerRendered(SERVER_RENDERED);
    expect(await landing.load()).toEqual(LANDING_FALLBACK);
  });

  test("on the server nothing is remembered: no seed, no fetched copy", async () => {
    const landing = scripted(false);
    landing.rememberServerRendered(SERVER_RENDERED);
    await landing.load();
    landing.nextFetch(OFFLINE);
    expect(await landing.load()).toEqual(LANDING_FALLBACK);
    expect(landing.shouldReload({ route: { id: "/community" } })).toBeUndefined();
  });

  // The server has no `window`, and neither has bun: with no explicit switch a
  // loader (the app's is built this way) must take that for the server.
  test("without an explicit switch, a runtime with no window remembers nothing", async () => {
    let next: Fetch = async () => PUBLISHED;
    const landing = createLandingRouteLoader({ fetchContent: () => next() });
    const community = { route: { id: "/community" } };
    landing.rememberServerRendered(SERVER_RENDERED);
    await landing.loader(community);
    next = OFFLINE;
    expect(await landing.loader(community)).toEqual(LANDING_FALLBACK);
    expect(landing.shouldReload(community)).toBeUndefined();
  });
});

describe("landing route loader: a failed load is not fresh", () => {
  test("a load that served a remembered or checked-in copy marks its route for reloading", async () => {
    for (const [name, failure] of Object.entries(FAILURES)) {
      const landing = scripted(true);
      const community = { route: { id: "/community" } };
      expect([name, landing.shouldReload(community)]).toEqual([name, undefined]);

      landing.nextFetch(failure);
      await landing.load("/community");
      expect([name, landing.shouldReload(community)]).toEqual([name, true]);
      expect([name, landing.shouldReload({ route: { id: "/how-it-works" } })]).toEqual([
        name,
        undefined,
      ]);
    }
  });

  // `undefined`, never `false`: false would also switch off the route's staleTime.
  test("a good load clears the mark and leaves the route's staleTime in charge", async () => {
    const landing = scripted(true);
    landing.nextFetch(OFFLINE);
    await landing.load("/community");
    landing.nextFetch(resolvesWith(REPUBLISHED));
    await landing.load("/community");
    expect(landing.shouldReload({ route: { id: "/community" } })).toBeUndefined();
  });
});

/** Lets every already-queued promise callback and zero-delay timer run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * A router wired like the app's landing routes (`src/routes/*`): one landing
 * route loader's `loader` and `shouldReload`, the routes' five-minute
 * staleTime and the app router's `defaultPreloadStaleTime` (`src/router.tsx`).
 * `isServer: false` takes the browser's loading path (`origin` stands in for
 * the `window.origin` it would read), and history changes start loads as the
 * router's Transitioner makes them do in the app.
 */
function landingRouter(landing: ReturnType<typeof scripted>) {
  const rootRoute = createRootRoute();
  const page = (path: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      loader: landing.loader,
      shouldReload: landing.shouldReload,
      staleTime: FIVE_MINUTES,
    });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page("/community"), page("/how-it-works")]),
    history: createMemoryHistory({ initialEntries: ["/community"] }),
    defaultPreloadStaleTime: 0,
    isServer: false,
    origin: "https://mila.example",
  });
  router.history.subscribe(router.load);
  return router;
}

/** The loader data of the page the router shows. */
function shown(router: ReturnType<typeof landingRouter>) {
  return router.state.matches.at(-1)?.loaderData;
}

describe("landing routes in a router: a failed load is fetched again", () => {
  test("the next visit to a page whose load failed fetches it again, inside its staleTime", async () => {
    const landing = scripted(true);
    landing.nextFetch(OFFLINE);
    const router = landingRouter(landing);
    await router.load();
    expect(shown(router)).toEqual(LANDING_FALLBACK);

    landing.nextFetch(resolvesWith(REPUBLISHED));
    await router.navigate({ to: "/how-it-works" });
    expect(landing.seen.fetches).toBe(2);

    await router.navigate({ to: "/community" });
    await settle();
    expect(landing.seen.fetches).toBe(3);
    expect(shown(router)).toEqual(REPUBLISHED);
  });

  test("going back to a page whose load failed fetches it again", async () => {
    const landing = scripted(true);
    landing.nextFetch(OFFLINE);
    const router = landingRouter(landing);
    await router.load();
    landing.nextFetch(resolvesWith(REPUBLISHED));
    await router.navigate({ to: "/how-it-works" });
    expect(landing.seen.fetches).toBe(2);

    router.history.back();
    await settle();
    await settle();
    expect(router.state.location.pathname).toBe("/community");
    expect(landing.seen.fetches).toBe(3);
    expect(shown(router)).toEqual(REPUBLISHED);
  });

  test("a page whose load succeeded is not fetched again inside its staleTime", async () => {
    const landing = scripted(true);
    const router = landingRouter(landing);
    await router.load();
    await router.navigate({ to: "/how-it-works" });
    await router.navigate({ to: "/community" });
    await settle();
    expect(landing.seen.fetches).toBe(2);
    expect(shown(router)).toEqual(PUBLISHED);
  });

  test("a page whose load succeeded is fetched again once its staleTime has passed", async () => {
    const landing = scripted(true);
    const router = landingRouter(landing);
    await router.load();
    await router.navigate({ to: "/how-it-works" });
    setSystemTime(new Date(Date.now() + FIVE_MINUTES));
    try {
      landing.nextFetch(resolvesWith(REPUBLISHED));
      await router.navigate({ to: "/community" });
      await settle();
    } finally {
      setSystemTime();
    }
    expect(landing.seen.fetches).toBe(3);
    expect(shown(router)).toEqual(REPUBLISHED);
  });
});
