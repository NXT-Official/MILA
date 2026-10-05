import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouteComponent,
} from "@tanstack/react-router";
import { AuthContext } from "@/hooks/use-auth";
import type { LandingContent } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import * as landingRouteLoader from "@/lib/landing-content.route-loader";
import { Route as CommunityRoute } from "./community";
import { Route as DupeHunterRoute } from "./dupe-hunter";
import { Route as HowItWorksRoute } from "./how-it-works";
import { Route as HomeRoute } from "./index";
import { Route as MembershipRoute } from "./membership";
import { Route as StyleDossierRoute } from "./style-dossier";

/** The landing page and the marketing subpages, at their paths in `routeTree.gen.ts`. */
const LANDING_ROUTES = [
  { path: "/", route: HomeRoute },
  { path: "/community", route: CommunityRoute },
  { path: "/how-it-works", route: HowItWorksRoute },
  { path: "/style-dossier", route: StyleDossierRoute },
  { path: "/dupe-hunter", route: DupeHunterRoute },
  { path: "/membership", route: MembershipRoute },
];

/** The routes' staleTime, which the router tests in `landing-content.route-loader.test.ts` assume. */
const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Loader data no other page is given. Every landing view renders the footer
 * tagline, so the markup shows the page rendered this data and nothing else.
 */
function contentFor(path: string): LandingContent {
  return {
    ...LANDING_FALLBACK,
    footer: { ...LANDING_FALLBACK.footer, tagline: `Loaded for ${path}` },
  };
}

function componentOf(path: string, component: RouteComponent | undefined): RouteComponent {
  if (!component) throw new Error(`${path} has no component`);
  return component;
}

/**
 * Renders a route's component the way the router renders it on the server: as
 * the match at `path`, whose loader resolved with `content`, under the auth
 * context and query client the app's root provides. That match has the id the
 * generated tree gives the real route, so the component's `Route.useLoaderData()`
 * finds it whether or not a router has set the real route up.
 */
async function renderAsMatch(path: string, component: RouteComponent, content: LandingContent) {
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider
          value={{
            user: null,
            session: null,
            loading: false,
            signingOut: false,
            signOut: async () => {},
          }}
        >
          <Outlet />
        </AuthContext.Provider>
      </QueryClientProvider>
    ),
  });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path,
    loader: () => content,
    component,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

// Each route must load through the one shared loader, or a failed client fetch
// reaches the root error page, and must hand its loader data to
// `useRememberServerRendered`, or a later failed fetch serves the checked-in
// copy over the Studio's.
describe("the landing routes use the shared landing route loader", () => {
  for (const { path, route } of LANDING_ROUTES) {
    test(`${path}: loads with the shared loader and reload rule, and goes stale after five minutes`, () => {
      expect(route.options.loader).toBe(landingRouteLoader.loadLandingContentForRoute);
      expect(route.options.shouldReload).toBe(landingRouteLoader.shouldReloadLandingRoute);
      expect(route.options.staleTime).toBe(FIVE_MINUTES);
    });

    test(`${path}: the page renders its loader data and hands it to useRememberServerRendered`, async () => {
      const content = contentFor(path);
      const remember = spyOn(landingRouteLoader, "useRememberServerRendered");
      try {
        const markup = await renderAsMatch(
          path,
          componentOf(path, route.options.component),
          content,
        );
        expect(markup).toContain(content.footer.tagline);
        expect(remember.mock.calls).toEqual([[content]]);
      } finally {
        remember.mockRestore();
      }
    });
  }
});
