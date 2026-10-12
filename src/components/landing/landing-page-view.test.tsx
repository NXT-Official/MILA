import { describe, expect, test } from "bun:test";
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
import { LandingPageView } from "./landing-page-view";

/** Every section an editor can hide from the home page, in page order. */
const SECTIONS = [
  "howItWorks",
  "dossier",
  "dailyPalette",
  "concierge",
  "dupeHunter",
  "feed",
  "community",
  "pricing",
  "finalCta",
] as const;
type SectionKey = (typeof SECTIONS)[number];

/** Copy as it appears in the markup: React escapes quotes and ampersands. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

/**
 * The palette and concierge now share one sticky stack, where each is a panel
 * headed by an `<h3>` under the stack's `<h2>`. Every other section keeps its
 * own `<h2>`. Body copy never closes either.
 */
const STACK_PANELS: readonly SectionKey[] = ["dailyPalette", "concierge"];

function heading(key: SectionKey) {
  const level = STACK_PANELS.includes(key) ? "h3" : "h2";
  return `>${text(LANDING_FALLBACK[key].heading)}</${level}>`;
}

const STACK_HEADING = ">Read your colors, compose the look, shop it.</h2>";

function withHidden(key: SectionKey): LandingContent {
  return { ...LANDING_FALLBACK, [key]: { ...LANDING_FALLBACK[key], hidden: true } };
}

/**
 * The page needs a router (Link), the auth context and a query client. No
 * plans are seeded, so pricing renders as it does on the server: heading over
 * skeleton cards.
 */
async function renderLanding(content: LandingContent) {
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
          <LandingPageView content={content} />
        </AuthContext.Provider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("the home page honours the Studio's visibility flags", () => {
  test("section headings are distinct, so one can't stand in for another", () => {
    expect(new Set(SECTIONS.map(heading)).size).toBe(SECTIONS.length);
  });

  test("with nothing hidden, every section renders", async () => {
    const out = await renderLanding(LANDING_FALLBACK);
    expect(out).toContain(text(LANDING_FALLBACK.hero.headlineLine1));
    expect(out).toContain(text(LANDING_FALLBACK.hero.headlineLine2));
    for (const key of SECTIONS) expect(out).toContain(heading(key));
    for (const t of LANDING_FALLBACK.testimonials) expect(out).toContain(text(t.quote));
  });

  for (const hidden of SECTIONS) {
    test(`hiding ${hidden} removes that section and no other`, async () => {
      const out = await renderLanding(withHidden(hidden));
      expect(out).toContain(text(LANDING_FALLBACK.hero.headlineLine1));
      for (const key of SECTIONS) {
        if (key === hidden) expect(out).not.toContain(heading(key));
        else expect(out).toContain(heading(key));
      }
    });
  }

  test("the palette and concierge are one sticky stack, not two text and image splits", async () => {
    const out = await renderLanding(LANDING_FALLBACK);
    expect(out.split(STACK_HEADING)).toHaveLength(2);
    expect(out.split("data-stack-panel")).toHaveLength(4);
    // Both headings sit inside the stack's section.
    const stack = out.slice(
      out.indexOf(STACK_HEADING),
      out.indexOf("</section>", out.indexOf(STACK_HEADING)),
    );
    expect(stack).toContain(heading("dailyPalette"));
    expect(stack).toContain(heading("concierge"));
  });

  test("hiding both the palette and the concierge removes the stack", async () => {
    const out = await renderLanding({
      ...withHidden("dailyPalette"),
      concierge: { ...LANDING_FALLBACK.concierge, hidden: true },
    });
    expect(out).not.toContain("data-stack-panel");
    expect(out).toContain(heading("dupeHunter"));
  });

  test("hiding testimonials removes every quote but keeps the community section", async () => {
    const out = await renderLanding({
      ...LANDING_FALLBACK,
      community: { ...LANDING_FALLBACK.community, hideTestimonials: true },
    });
    for (const t of LANDING_FALLBACK.testimonials) expect(out).not.toContain(text(t.quote));
    expect(out).toContain(heading("community"));
  });
});
