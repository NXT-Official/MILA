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
import { MarketingSubpage } from "./marketing-subpage";

type SubpageContent = Pick<LandingContent, "footer" | "cta" | "subpageCta">;

/** Copy as it appears in the markup: React escapes quotes, ampersands and angle brackets. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

/** The inner markup of the page's one `<main>`, `<header>` or `<footer>`. */
function inside(markup: string, tag: "main" | "footer" | "header") {
  return markup.match(new RegExp(`<${tag}\\b[^>]*>(.*)</${tag}>`, "s"))?.[1] ?? "";
}

/** Every link in the markup, in document order: its destination and what it contains. */
function links(markup: string) {
  return [...markup.matchAll(/<a\b[^>]* href="([^"]*)"[^>]*>(.*?)<\/a>/gs)].map(
    ([, href, inner]) => ({ href, inner }),
  );
}

const TITLE = "Edited page title";
const CHILD = "Edited child section";

/** Everything the subpage takes from content, set to copy the fallback does not contain. */
const EDITED: SubpageContent = {
  footer: {
    ...LANDING_FALLBACK.footer,
    wordmark: "EDITED WORDMARK",
    tagline: "Edited tagline — it's short & sweet.",
  },
  cta: { ...LANDING_FALLBACK.cta, signedOutLabel: "Edited subpage label" },
  subpageCta: { ...LANDING_FALLBACK.subpageCta, heading: "Edited subpage heading?" },
};

/** The header, CTA and footer need a router (Link) and the auth context. */
async function renderSubpage(content: SubpageContent = EDITED) {
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
        <MarketingSubpage title={TITLE} content={content}>
          <p>{CHILD}</p>
        </MarketingSubpage>
      </AuthContext.Provider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("MarketingSubpage", () => {
  test("renders its children in <main>, after the page title and before the shared CTA", async () => {
    const main = inside(await renderSubpage(), "main");
    const titleAt = main.indexOf(`>${text(TITLE)}</h1>`);
    const childAt = main.indexOf(`<p>${text(CHILD)}</p>`);
    const ctaAt = main.indexOf(`>${text(EDITED.subpageCta.heading)}<`);
    expect(titleAt).toBeGreaterThan(-1);
    expect(childAt).toBeGreaterThan(titleAt);
    expect(ctaAt).toBeGreaterThan(childAt);
  });

  test("the shared CTA uses the heading and label it is given, and goes to /login", async () => {
    const main = inside(await renderSubpage(), "main");
    expect(main).toContain(`>${text(EDITED.subpageCta.heading)}<`);
    const cta = links(main).filter((link) =>
      link.inner.startsWith(text(EDITED.cta.signedOutLabel)),
    );
    expect(cta.map((link) => link.href)).toEqual(["/login"]);
  });

  test("the footer wordmark and tagline come from content", async () => {
    const footer = inside(await renderSubpage(), "footer");
    expect(footer).toContain(`${text(EDITED.footer.wordmark)}<`);
    expect(footer).toContain(`>${text(EDITED.footer.tagline)}`);
  });

  test("the header wordmark comes from the same content as the footer (Morpessa MW-16)", async () => {
    const header = inside(await renderSubpage(), "header");
    expect(header).toContain(`${text(EDITED.footer.wordmark)}<`);
  });

  test("the footer's only links are the legal ones: /privacy, then /terms", async () => {
    const footer = inside(await renderSubpage(), "footer");
    expect(links(footer).map((link) => link.href)).toEqual(["/privacy", "/terms"]);
  });
});
