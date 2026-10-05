import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AuthContext } from "@/hooks/use-auth";
import type { CtaContent, FinalCtaContent } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { normalizeLandingContent } from "@/lib/landing-content.normalize";
import { FinalCtaSection } from "./final-cta-section";

const TARGET = { projectId: "8bkzi9bn", dataset: "production" };
const CDN = "https://cdn.sanity.io/images/8bkzi9bn/production/abc-800x600.jpg";

/** Copy as it appears in the markup: React escapes quotes, ampersands and angle brackets. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

/** Every link destination in the markup, in document order. */
function hrefs(markup: string) {
  return [...markup.matchAll(/ href="([^"]*)"/g)].map(([, href]) => href);
}

/** The section's CtaButton needs a router (Link) and the auth context. */
async function renderFinalCta(content: FinalCtaContent, cta?: CtaContent, signedIn = false) {
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
        <FinalCtaSection content={content} cta={cta} />
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

/** Every text field the section renders, set to copy the fallback does not contain. */
const EDITED: FinalCtaContent = {
  ...LANDING_FALLBACK.finalCta,
  heading: "Edited closing heading",
  body: "Edited closing body — it's short & sweet.",
  privacyNote: "Edited privacy note",
};
const LABELS: CtaContent = {
  signedOutLabel: "Edited closing label",
  signedInLabel: "Edited member label",
};

describe("FinalCtaSection renders its content", () => {
  test("heading, body, privacy note and button label", async () => {
    const out = await renderFinalCta(EDITED, LABELS);
    expect(out).toContain(`>${text(EDITED.heading)}</h2>`);
    expect(out).toContain(`>${text(EDITED.body)}<`);
    expect(out).toContain(`${text(EDITED.privacyNote)}<`);
    expect(out).toContain(`>${text(LABELS.signedOutLabel)}<`);
  });

  test("the backdrop is the content's image and stays hidden from assistive tech", async () => {
    const content = normalizeLandingContent(
      { finalCta: { backgroundImage: { url: CDN, alt: "A described backdrop" } } },
      TARGET,
    ).finalCta;
    // Guard: the Studio image and its alt text survived validation.
    expect(content.backgroundImage.src.startsWith(CDN)).toBe(true);
    expect(content.backgroundImage.alt).toMatch(/\S/);

    const out = await renderFinalCta(content);
    const [backdrop, ...others] = out.match(/<img\b[^>]*>/g) ?? [];
    expect(others).toEqual([]);
    expect(backdrop).toContain(` src="${text(content.backgroundImage.src)}"`);
    expect(backdrop).toContain(' alt=""');
    expect(backdrop).toContain(' aria-hidden="true"');
    expect(out).not.toContain(text(content.backgroundImage.alt));
  });
});

describe("FinalCtaSection button destination is code-owned", () => {
  const EVIL = "https://evil.example/phish";
  /** Fields the Studio schema does not have, as a tampered document might carry them. */
  const tampered = {
    ...EDITED,
    href: EVIL,
    to: EVIL,
    url: EVIL,
    ctaHref: EVIL,
  } as FinalCtaContent;
  const tamperedLabels = { ...LABELS, href: EVIL, to: EVIL, signedOutHref: EVIL } as CtaContent;

  test("signed out: the only link is /login, whatever the content carries", async () => {
    const out = await renderFinalCta(tampered, tamperedLabels);
    // Guard: the tampered objects are what was rendered.
    expect(out).toContain(`>${text(tampered.heading)}</h2>`);
    expect(out).toContain(`>${text(tamperedLabels.signedOutLabel)}<`);

    expect(hrefs(out)).toEqual(["/login"]);
    expect(out).not.toContain("evil.example");
  });

  test("signed in: the only link is /dashboard, whatever the content carries", async () => {
    const out = await renderFinalCta(tampered, tamperedLabels, true);
    expect(out).toContain(`>${text(tamperedLabels.signedInLabel)}<`);

    expect(hrefs(out)).toEqual(["/dashboard"]);
    expect(out).not.toContain("evil.example");
  });
});
