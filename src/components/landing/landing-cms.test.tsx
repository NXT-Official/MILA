import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AuthContext } from "@/hooks/use-auth";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { normalizeLandingContent } from "@/lib/landing-content.normalize";
import { CtaButton } from "./cta-button";
import { ConciergeSection } from "./concierge-section";
import { DailyPaletteSection } from "./daily-palette-section";
import { FeedSection } from "./feed-section";
import { DupeHunterSection } from "./dupe-hunter-section";

const TARGET = { projectId: "8bkzi9bn", dataset: "production" };
const CDN = "https://cdn.sanity.io/images/8bkzi9bn/production/abc-800x600.jpg";

function html(node: React.ReactNode) {
  return renderToStaticMarkup(node);
}

/** CtaButton needs a router (Link) and the auth context. */
async function renderCta(labels = LANDING_FALLBACK.cta, signedIn = false) {
  const rootRoute = createRootRoute({
    component: () => (
      <AuthContext.Provider
        value={{
          user: signedIn ? ({ id: "u1" } as never) : null,
          session: null,
          loading: false,
          signingOut: false,
          signOut: async () => {},
        }}
      >
        <CtaButton labels={labels} />
      </AuthContext.Provider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return html(<RouterProvider router={router} />);
}

describe("landing sections render Studio content", () => {
  test("the palette renders CMS swatches and image", () => {
    const content = normalizeLandingContent(
      {
        dailyPalette: {
          heading: "Today's mix",
          image: { url: CDN, alt: "A flat-lay in sage" },
          swatches: [{ _key: "a", label: "Sage", hex: "#9caf88" }],
        },
      },
      TARGET,
    ).dailyPalette;
    const out = html(<DailyPaletteSection content={content} />);
    expect(out).toContain("Today&#x27;s mix");
    expect(out).toContain(`src="${CDN}?auto=format&amp;fit=max&amp;w=960"`);
    expect(out).toContain('alt="A flat-lay in sage"');
    expect(out).toContain("background-color:#9CAF88");
    expect(out).not.toContain("Base Layer");
  });

  test("HTML-looking CMS text is escaped, never injected", () => {
    const content = normalizeLandingContent(
      { concierge: { heading: "<script>alert(1)</script>" } },
      TARGET,
    ).concierge;
    const out = html(<ConciergeSection content={content} />);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  test("feed and dupe cards use their own images and alt text", () => {
    const content = normalizeLandingContent(
      {
        feed: { images: [{ _key: "a", url: CDN, alt: "Member look" }] },
        dupeHunter: { milaMatch: { image: { url: CDN, alt: "The match" } } },
      },
      TARGET,
    );
    expect(html(<FeedSection content={content.feed} />)).toContain('alt="Member look"');
    const dupe = html(<DupeHunterSection content={content.dupeHunter} />);
    expect(dupe).toContain('alt="The match"');
    expect(dupe).toContain(LANDING_FALLBACK.dupeHunter.inspiration.image.alt);
  });
});

describe("CTA labels are editable, destinations are not", () => {
  test("signed out: Studio label, /login destination", async () => {
    const out = await renderCta({ signedOutLabel: "Start free", signedInLabel: "Studio" });
    expect(out).toContain("Start free");
    expect(out).toContain('href="/login"');
  });

  test("signed in: Studio label, /dashboard destination", async () => {
    const out = await renderCta({ signedOutLabel: "Start free", signedInLabel: "Back in" }, true);
    expect(out).toContain("Back in");
    expect(out).toContain('href="/dashboard"');
  });

  test("defaults to the pre-CMS labels", async () => {
    expect(await renderCta()).toContain("Get your first look");
  });
});
