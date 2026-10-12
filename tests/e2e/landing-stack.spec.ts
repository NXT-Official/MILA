import { test, expect, type Page } from "@playwright/test";

/**
 * The home page's "read your colors, compose the look, shop it" sticky stack
 * (src/components/landing/style-flow-stack.tsx, sticky-stack-motion.ts).
 *
 * - GSAP is loaded only on a wide, tall screen with motion allowed. Under
 *   reduced motion or on a phone, no GSAP request is ever made: each test runs
 *   in a fresh browser context with its media settings from the start and the
 *   HTTP cache off, so no request can be carried over from another run.
 * - While pinned, the stack never shows a blank band: the incoming card's top
 *   is at or above the pinned card's bottom, and a card that covers another is
 *   fully opaque, so nothing shows through it (LANDING review C1).
 */

const GSAP_REQUEST = /gsap|ScrollTrigger/i;

// The dev server's HMR socket (`wss://host/?token=…`) reloads the page whenever
// any file in the shared tree changes, which tears down a scroll walk midway.
// A silent mock keeps the socket open and sends nothing, so no reload arrives.
// src: https://playwright.dev/docs/api/class-websocketroute ("by default, the
// routed WebSocket will not connect to the server") · @playwright/test 1.63
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/[?&]token=/, () => {});
});

/** Every request URL the page makes, recorded with the HTTP cache switched off. */
async function recordRequests(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

/** Waits until the browser has painted twice, so ScrollTrigger has applied the last scroll. */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ),
  );
}

async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
  await settle(page);
}

/** Opens the home page and walks through the whole stack. */
async function walkThroughStack(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  const stack = page.locator("#style-flow");
  await expect(stack).toBeVisible();
  await expect(page.locator("[data-stack-panel]")).toHaveCount(3);
  const { top, height } = await stack.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top + window.scrollY, height: rect.height };
  });
  for (let y = Math.max(0, top - 400); y <= top + height; y += 200) await scrollTo(page, y);
  await page.waitForLoadState("networkidle");
}

type CardState = { top: number; bottom: number; opacity: number; visible: boolean };

async function cardStates(page: Page): Promise<CardState[]> {
  return page.locator("[data-stack-card]").evaluateAll((cards) =>
    cards.map((card) => {
      const rect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      const opacity = Number(style.opacity);
      return {
        top: rect.top,
        bottom: rect.bottom,
        opacity,
        visible: style.visibility !== "hidden" && opacity > 0.01,
      };
    }),
  );
}

test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });

  test("GSAP is never requested and the panels stay static", async ({ page }) => {
    const urls = await recordRequests(page);
    await walkThroughStack(page);
    expect(urls.filter((url) => GSAP_REQUEST.test(url))).toEqual([]);
    await expect(page.locator("[data-stack-motion]")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });

  test("GSAP is never requested and the panels stay static", async ({ page }) => {
    const urls = await recordRequests(page);
    await walkThroughStack(page);
    expect(urls.filter((url) => GSAP_REQUEST.test(url))).toEqual([]);
    await expect(page.locator("[data-stack-motion]")).toHaveCount(0);
  });
});

test.describe("on a desktop with motion allowed", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });

  test("GSAP is requested and the stack pins under the header", async ({ page }) => {
    const urls = await recordRequests(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator('[data-stack-motion="on"]')).toHaveCount(1, { timeout: 15_000 });
    expect(urls.some((url) => GSAP_REQUEST.test(url))).toBe(true);

    const pinLine = await page.evaluate(
      () => Math.round(document.querySelector("header")?.getBoundingClientRect().height ?? 0) + 16,
    );
    const firstTop = await page
      .locator("[data-stack-panel]")
      .first()
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

    // Pinned: the first panel holds its place under the header while the page
    // scrolls on. (The panel, not its card: the card recedes from its top.)
    const firstPanelTop = () =>
      page
        .locator("[data-stack-panel]")
        .first()
        .evaluate((el) => el.getBoundingClientRect().top);
    await scrollTo(page, firstTop - pinLine + 40);
    const early = await firstPanelTop();
    await scrollTo(page, firstTop - pinLine + 240);
    const later = await firstPanelTop();
    expect(Math.abs(early - pinLine)).toBeLessThanOrEqual(1);
    expect(Math.abs(later - pinLine)).toBeLessThanOrEqual(1);
  });

  test("while pinned, the cards leave no blank band and nothing shows through a covering card", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator('[data-stack-motion="on"]')).toHaveCount(1, { timeout: 15_000 });

    const { start, end, viewport } = await page.evaluate(() => {
      const panels = [...document.querySelectorAll("[data-stack-panel]")];
      const absTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
      return {
        start: absTop(panels[0]) - window.innerHeight,
        end: absTop(panels[panels.length - 1]) + 200,
        viewport: window.innerHeight,
      };
    });

    let overlapSamples = 0;
    for (let y = Math.max(0, Math.round(start)); y <= end; y += 40) {
      await scrollTo(page, y);
      // In page order: a later card paints over an earlier one.
      const onScreen = (await cardStates(page)).filter(
        (card) => card.visible && card.bottom > 0 && card.top < viewport,
      );
      for (let i = 1; i < onScreen.length; i++) {
        const [earlier, later] = [onScreen[i - 1], onScreen[i]];
        // No blank band: the arriving card's top is at or above the pinned card's bottom.
        expect([y, later.top - earlier.bottom <= 0.5]).toEqual([y, true]);
        // A card lying over another is opaque, so nothing ghosts through it.
        if (later.top < earlier.bottom - 1) {
          overlapSamples += 1;
          expect([y, later.opacity]).toEqual([y, 1]);
        }
      }
    }
    // Guard: the walk really saw a card sliding over a pinned one.
    expect(overlapSamples).toBeGreaterThan(10);
  });
});
