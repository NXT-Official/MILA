import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AuthContext } from "@/hooks/use-auth";
import type { LandingContent } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { CommunityPageView } from "./community-page-view";

/** Copy as it appears in the markup: React escapes quotes and ampersands. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

const COMMUNITY_HEADING = `>${text(LANDING_FALLBACK.community.heading)}</h2>`;

function withCommunity(overrides: Partial<LandingContent["community"]>): LandingContent {
  return { ...LANDING_FALLBACK, community: { ...LANDING_FALLBACK.community, ...overrides } };
}

/** The subpage shell needs a router (Link) and the auth context. */
async function renderCommunity(content: LandingContent) {
  const rootRoute = createRootRoute({
    component: () => (
      <AuthContext.Provider
        value={{
          user: null,
          session: null,
          loading: false,
          signingOut: false,
          signOut: async () => {},
        }}
      >
        <CommunityPageView content={content} />
      </AuthContext.Provider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/community"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("the community page", () => {
  test("with nothing hidden, the section and its testimonials render", async () => {
    const out = await renderCommunity(LANDING_FALLBACK);
    expect(out).toContain(COMMUNITY_HEADING);
    for (const t of LANDING_FALLBACK.testimonials) expect(out).toContain(text(t.quote));
  });

  test("hiding testimonials removes every quote but keeps the community section", async () => {
    const out = await renderCommunity(withCommunity({ hideTestimonials: true }));
    for (const t of LANDING_FALLBACK.testimonials) expect(out).not.toContain(text(t.quote));
    expect(out).toContain(COMMUNITY_HEADING);
  });

  // Owner ruling: `hidden` takes a section off the home page, not off its own page.
  test("hiding the section on the home page does not blank its dedicated page", async () => {
    const out = await renderCommunity(withCommunity({ hidden: true }));
    expect(out).toContain(COMMUNITY_HEADING);
    for (const t of LANDING_FALLBACK.testimonials) expect(out).toContain(text(t.quote));
  });
});
