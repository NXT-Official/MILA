import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import type { LandingContent } from "@/lib/landing-content";
import { MILA_DEPLOYMENT_ORIGINS } from "@/lib/auth-origin";
import { SITE_CONTEXT_ROUTE_OPTIONS, type SiteContext } from "@/lib/site-seo";

// The real root loader calls the server function; the test controls what it answers.
// src: bun test mock.module, same restore pattern as posthog-client.test.ts
const realFunctions = await import("@/lib/site-context.functions");
let answer: () => Promise<SiteContext> = async () => SERVER_SITE;
const calls = { site: 0 };

// Before the route modules are imported, so the root loader binds to the mock.
mock.module("@/lib/site-context.functions", () => ({
  getSiteContext: () => {
    calls.site += 1;
    return answer();
  },
}));
afterAll(() => {
  mock.module("@/lib/site-context.functions", () => realFunctions);
});

// A fresh instance of the root module (query string), so the loader binds to the mock
// even when an earlier test file already imported the real one.
const rootSpecifier = "./__root?site-context-test";
const { Route: RootRoute } = (await import(rootSpecifier)) as typeof import("./__root");
const { Route: CommunityRoute } = await import("./community");
const { Route: DupeHunterRoute } = await import("./dupe-hunter");
const { Route: HomeRoute } = await import("./index");
const { Route: HowItWorksRoute } = await import("./how-it-works");
const { Route: LoginRoute } = await import("./login");
const { Route: MembershipRoute } = await import("./membership");
const { Route: PrivacyRoute } = await import("./privacy");
const { Route: StyleDossierRoute } = await import("./style-dossier");
const { Route: TermsRoute } = await import("./terms");

type Tag = Record<string, string>;
type HeadResult = { meta?: Tag[]; links?: Tag[] };
type HeadFn = (ctx: never) => HeadResult | Promise<HeadResult>;

const SERVER_SITE: SiteContext = { origin: "https://mila.example", indexable: true };

const HOME_CONTENT: LandingContent = {
  ...LANDING_FALLBACK,
  seo: {
    ...LANDING_FALLBACK.seo,
    title: "Edited home title",
    description: "Edited home description",
    socialDescription: "Edited home social description",
  },
};

const PAGES = [
  { path: "/", route: HomeRoute },
  { path: "/how-it-works", route: HowItWorksRoute },
  { path: "/community", route: CommunityRoute },
  { path: "/membership", route: MembershipRoute },
  { path: "/dupe-hunter", route: DupeHunterRoute },
  { path: "/style-dossier", route: StyleDossierRoute },
  { path: "/privacy", route: PrivacyRoute },
  { path: "/terms", route: TermsRoute },
] as const;

/** A minimal browser, so the router runs its client lane. Removed after each test. */
function stubWindow() {
  const stub = {
    origin: "http://localhost",
    addEventListener: () => {},
    removeEventListener: () => {},
    scrollTo: () => {},
    history: {},
    location: { href: "http://localhost/" },
  };
  Object.assign(globalThis, { window: stub });
}
function unstubWindow() {
  Reflect.deleteProperty(globalThis, "window");
}

/**
 * A router with the REAL root loader and head (so the loader's call to
 * getSiteContext is exercised) and each page's real head.
 */
function buildRouter(initial: string, { client = false } = {}) {
  const rootRoute = createRootRoute({
    ...SITE_CONTEXT_ROUTE_OPTIONS,
    loader: RootRoute.options.loader as () => Promise<SiteContext | undefined>,
    head: (ctx) => (RootRoute.options.head as HeadFn)(ctx as never),
  });
  const children = PAGES.map(({ path, route }) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      loader: () => (path === "/" ? HOME_CONTENT : LANDING_FALLBACK),
      head: (ctx) => (route.options.head as HeadFn)(ctx as never),
    }),
  );
  const login = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    head: (ctx) => (LoginRoute.options.head as HeadFn)(ctx as never),
  });
  return createRouter({
    routeTree: rootRoute.addChildren([...children, login]),
    history: createMemoryHistory({ initialEntries: [initial] }),
    defaultPreload: false,
    ...(client ? { isServer: false } : {}),
  });
}
type TestRouter = ReturnType<typeof buildRouter>;

/** Every tag from every match, root first, deepest last, as the document head is assembled. */
function tags(router: TestRouter) {
  const matches = router.state.matches;
  const meta = matches
    .flatMap((m) => (m.meta ?? []) as (Tag | undefined)[])
    .filter(Boolean) as Tag[];
  const links = matches
    .flatMap((m) => (m.links ?? []) as (Tag | undefined)[])
    .filter(Boolean) as Tag[];
  return { meta, links };
}
/** The tag that wins in the document: the deepest, like HeadContent's own de-duplication. */
const deepest = (list: Tag[], pick: (t: Tag) => boolean) => list.filter(pick).at(-1);

async function go(router: TestRouter, path: string) {
  router.history.push(path);
  await router.load();
}

beforeEach(() => {
  calls.site = 0;
  answer = async () => SERVER_SITE;
});
afterEach(unstubWindow);

describe("the root loader", () => {
  test("is the real one: it calls getSiteContext and serialises its answer", async () => {
    answer = async () => ({ origin: "https://mila-nicoledev.vercel.app", indexable: false });
    const router = buildRouter("/community");
    await router.load();
    expect(calls.site).toBe(1);
    expect(router.state.matches[0].loaderData).toEqual({
      origin: "https://mila-nicoledev.vercel.app",
      indexable: false,
    });
  });

  test("is configured to load once", () => {
    expect(RootRoute.options.shouldReload).toBe(false);
    expect(RootRoute.options.staleTime).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("origin parity between the server render and client navigation", () => {
  test("SSR lane: every page has canonical and og:url from the one serialised origin", async () => {
    const router = buildRouter("/");
    await router.load();
    for (const { path } of PAGES) {
      await go(router, path);
      const { meta, links } = tags(router);
      expect(deepest(links, (l) => l.rel === "canonical")?.href).toBe(
        `https://mila.example${path}`,
      );
      expect(deepest(meta, (t) => t.property === "og:url")?.content).toBe(
        `https://mila.example${path}`,
      );
      expect(deepest(meta, (t) => t.property === "og:image")?.content).toStartWith(
        "https://mila.example/",
      );
    }
  });

  test("client lane: the same canonical after navigations, and the server is asked once", async () => {
    // src: node_modules/@tanstack/router-core/dist/esm/router.js (1.171.34)
    //      `isServer` router option picks the client loader lane; the window stub satisfies it
    stubWindow();
    const ssr = buildRouter("/community");
    await ssr.load();
    const first = deepest(tags(ssr).links, (l) => l.rel === "canonical")?.href;

    const router = buildRouter("/community", { client: true });
    expect(router.isServer).toBe(false);
    await router.load();
    expect(deepest(tags(router).links, (l) => l.rel === "canonical")?.href).toBe(first);
    for (const { path } of PAGES) {
      await go(router, path);
      expect(deepest(tags(router).links, (l) => l.rel === "canonical")?.href).toBe(
        `https://mila.example${path}`,
      );
    }
    await go(router, "/community");
    expect(deepest(tags(router).links, (l) => l.rel === "canonical")?.href).toBe(first);
    // one load for the SSR router above, one for the client router, none per navigation
    expect(calls.site).toBe(2);
  });

  test("the home page's own title and og:description win over the root defaults", async () => {
    const router = buildRouter("/");
    await router.load();
    const { meta, links } = tags(router);
    expect(deepest(meta, (t) => "title" in t)?.title).toBe("Edited home title");
    expect(deepest(meta, (t) => t.property === "og:description")?.content).toBe(
      "Edited home social description",
    );
    expect(deepest(meta, (t) => t.name === "description")?.content).toBe("Edited home description");
    expect(deepest(links, (l) => l.rel === "canonical")?.href).toBe("https://mila.example/");
  });
});

describe("a failing site context never takes a page down", () => {
  const LIVE = MILA_DEPLOYMENT_ORIGINS[0];

  test("SSR: every page renders its head with the fallback origin", async () => {
    answer = async () => {
      throw new Error("server function failed");
    };
    const router = buildRouter("/");
    await router.load();
    for (const { path } of PAGES) {
      await go(router, path);
      expect(router.state.matches.every((m) => m.status === "success")).toBe(true);
      const { meta, links } = tags(router);
      expect(deepest(links, (l) => l.rel === "canonical")?.href).toBe(`${LIVE}${path}`);
      expect(deepest(meta, (t) => t.property === "og:image")?.content).toStartWith(LIVE);
    }
  });

  test("client: a failure after router.invalidate() keeps the origin it had and the page", async () => {
    stubWindow();
    const router = buildRouter("/community", { client: true });
    await router.load();
    answer = async () => {
      throw new Error("offline");
    };
    await router.invalidate();
    // the reload runs in the background; give a failure time to land
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.site).toBe(2);
    expect(router.state.matches.every((m) => m.status === "success")).toBe(true);
    expect(deepest(tags(router).links, (l) => l.rel === "canonical")?.href).toBe(
      "https://mila.example/community",
    );
  });
});

describe("indexing", () => {
  test("a live host gets no robots noindex", async () => {
    const router = buildRouter("/community");
    await router.load();
    expect(tags(router).meta.find((t) => t.name === "robots")).toBeUndefined();
  });

  test("a non-live host gets noindex on every page", async () => {
    answer = async () => ({ origin: MILA_DEPLOYMENT_ORIGINS[0], indexable: false });
    const router = buildRouter("/");
    await router.load();
    for (const { path } of PAGES) {
      await go(router, path);
      const robots = tags(router).meta.filter((t) => t.name === "robots");
      expect(robots.map((t) => t.content)).toEqual(["noindex"]);
    }
  });

  test("login is noindex, follow even on the live host", async () => {
    const router = buildRouter("/login");
    await router.load();
    const robots = tags(router).meta.filter((t) => t.name === "robots");
    expect(robots.map((t) => t.content)).toEqual(["noindex, follow"]);
  });
});
