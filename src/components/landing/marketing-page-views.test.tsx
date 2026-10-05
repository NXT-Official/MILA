import { describe, expect, test } from "bun:test";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AuthContext } from "@/hooks/use-auth";
import type { LandingContent } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { DupeHunterPageView } from "./dupe-hunter-page-view";
import { HowItWorksPageView } from "./how-it-works-page-view";
import { MembershipPageView } from "./membership-page-view";
import { StyleDossierPageView } from "./style-dossier-page-view";

type PageSection = "howItWorks" | "dossier" | "dupeHunter" | "pricing";

/** Each marketing subpage and the one section it is about. (`/community` has its own test.) */
const PAGES: {
  path: string;
  View: ComponentType<{ content: LandingContent }>;
  section: PageSection;
}[] = [
  { path: "/how-it-works", View: HowItWorksPageView, section: "howItWorks" },
  { path: "/style-dossier", View: StyleDossierPageView, section: "dossier" },
  { path: "/dupe-hunter", View: DupeHunterPageView, section: "dupeHunter" },
  { path: "/membership", View: MembershipPageView, section: "pricing" },
];

/** Copy as it appears in the markup: React escapes quotes and ampersands. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

/** A section's heading is its `<h2>`; body copy never closes one. */
function heading(section: PageSection) {
  return `>${text(LANDING_FALLBACK[section].heading)}</h2>`;
}

function withHidden(section: PageSection): LandingContent {
  return { ...LANDING_FALLBACK, [section]: { ...LANDING_FALLBACK[section], hidden: true } };
}

/**
 * The subpage shell needs a router (Link) and the auth context; the
 * membership page's pricing also needs a query client. No plans are seeded,
 * so pricing renders as it does on the server: heading over skeleton cards.
 */
async function renderPage(
  View: ComponentType<{ content: LandingContent }>,
  path: string,
  content: LandingContent,
) {
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
          <View content={content} />
        </AuthContext.Provider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("each marketing subpage shows its own section", () => {
  for (const { path, View, section } of PAGES) {
    test(`${path}: with nothing hidden, the ${section} section renders`, async () => {
      expect(await renderPage(View, path, LANDING_FALLBACK)).toContain(heading(section));
    });

    // Owner ruling: `hidden` takes a section off the home page, not off its own page.
    test(`${path}: hiding ${section} on the home page changes nothing on its dedicated page`, async () => {
      const out = await renderPage(View, path, withHidden(section));
      expect(out).toContain(heading(section));
      expect(out).toBe(await renderPage(View, path, LANDING_FALLBACK));
    });
  }
});
