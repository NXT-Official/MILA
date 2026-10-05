import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AuthContext } from "@/hooks/use-auth";
import type { CtaContent, HeroContent } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { normalizeLandingContent } from "@/lib/landing-content.normalize";
import { HeroSection } from "./hero-section";

const TARGET = { projectId: "8bkzi9bn", dataset: "production" };
const CDN = "https://cdn.sanity.io/images/8bkzi9bn/production/abc-800x600.jpg";

/** Copy as it appears in the markup: React escapes quotes, ampersands and angle brackets. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

/** Every `<img>` in the markup, as its `src` and `alt` (still escaped). */
function images(markup: string) {
  return [...markup.matchAll(/<img\b[^>]*>/g)].map(([tag]) => ({
    src: tag.match(/ src="([^"]*)"/)?.[1],
    alt: tag.match(/ alt="([^"]*)"/)?.[1],
  }));
}

function count(markup: string, needle: string) {
  return markup.split(needle).length - 1;
}

/** The hero's CtaButton needs a router (Link) and the auth context. */
async function renderHero(content: HeroContent, cta?: CtaContent) {
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
        <HeroSection content={content} cta={cta} />
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

/** Every text field the hero renders, set to copy the fallback does not contain. */
const EDITED: HeroContent = {
  ...LANDING_FALLBACK.hero,
  kicker: "Edited kicker",
  headlineLine1: "Edited first line.",
  headlineLine2: "Edited second line.",
  subhead: "Edited subhead — it's tuned & tailored.",
  ctaNote: "Edited CTA note",
  preview: {
    ...LANDING_FALLBACK.hero.preview,
    season: "Edited Season",
    weather: "31°C · Edited weather",
  },
  imageCaption: "Edited caption",
};

describe("HeroSection renders its content", () => {
  test("kicker, both headline lines, subhead, CTA note, preview and caption", async () => {
    const out = await renderHero(EDITED);

    const h1 = out.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1] ?? "";
    const line1At = h1.indexOf(text(EDITED.headlineLine1));
    expect(line1At).toBe(0);
    expect(h1.indexOf(text(EDITED.headlineLine2))).toBeGreaterThan(line1At);

    expect(out).toContain(`${text(EDITED.kicker)}<`);
    expect(out).toContain(`>${text(EDITED.subhead)}<`);
    expect(out).toContain(`>${text(EDITED.ctaNote)}<`);
    expect(out).toContain(`>${text(EDITED.preview.season)}<`);
    expect(out).toContain(`>${text(EDITED.preview.weather)}<`);
    expect(out).toContain(`>${text(EDITED.imageCaption)}<`);
  });

  test("the button carries the CTA label the hero is given", async () => {
    const cta = { ...LANDING_FALLBACK.cta, signedOutLabel: "Edited hero label" };
    const out = await renderHero(EDITED, cta);
    expect(out).toContain(`>${text(cta.signedOutLabel)}<`);
  });
});

describe("HeroSection image", () => {
  test("a Studio image is rendered with its own URL and alt text", async () => {
    const content = normalizeLandingContent(
      { hero: { image: { url: CDN, alt: 'Edited "hero" alt' } } },
      TARGET,
    ).hero;
    // Guard: the Studio image survived validation, so this is not the fallback.
    expect(content.image.src.startsWith(CDN)).toBe(true);

    const out = await renderHero(content);
    expect(images(out)).toEqual([{ src: text(content.image.src), alt: text(content.image.alt) }]);
    expect(out).not.toContain(LANDING_FALLBACK.hero.image.src);
  });

  test.each([
    ["no image", {}],
    ["an image without alt text", { image: { url: CDN } }],
  ])("with %s, the built-in style sheet and its alt text are used", async (_case, hero) => {
    const content = normalizeLandingContent({ hero }, TARGET).hero;
    const [img, ...others] = images(await renderHero(content));
    expect(others).toEqual([]);
    expect(img.src).toBe(text(LANDING_FALLBACK.hero.image.src));
    expect(img.alt).toBe(text(LANDING_FALLBACK.hero.image.alt));
    expect(img.alt).toMatch(/\S/);
  });
});

describe("HeroSection escapes its content", () => {
  test("HTML-looking text is shown as text, never rendered as an element", async () => {
    const script = "<script>alert(1)</script>";
    const bold = "<b>x</b>";
    const out = await renderHero(
      {
        ...LANDING_FALLBACK.hero,
        kicker: script,
        headlineLine1: bold,
        headlineLine2: script,
        subhead: bold,
        ctaNote: script,
        preview: { ...LANDING_FALLBACK.hero.preview, season: bold, weather: script },
        image: { ...LANDING_FALLBACK.hero.image, alt: bold },
        imageCaption: script,
      },
      { signedOutLabel: bold, signedInLabel: bold },
    );

    expect(out).not.toContain("<script");
    expect(out).not.toContain("<b>");
    // Five fields carry each string; every one of them is rendered, escaped.
    expect(count(out, "&lt;script&gt;alert(1)&lt;/script&gt;")).toBe(5);
    expect(count(out, "&lt;b&gt;x&lt;/b&gt;")).toBe(5);
  });
});
