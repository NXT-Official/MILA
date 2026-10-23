import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Runtime accessibility scan for MILA's unauthenticated public routes.
 *
 * Scope is intentionally limited to these routes and `/login`: every other
 * route sits behind Supabase session auth (see src/routes/_authenticated),
 * which would require a full login flow (and hCaptcha) to reach.
 * Authenticated routes are covered by manual a11y review instead (see Item 7
 * of the a11y punch list).
 */

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/how-it-works",
  "/style-dossier",
  "/dupe-hunter",
  "/community",
  "/membership",
];

test.describe("accessibility", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no automatically detectable a11y violations`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("body")).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      expect(results.violations).toEqual([]);
    });
  }
});

/**
 * The sign-in pages paint soft colour blobs behind the header. On narrow
 * screens the top-left blob sits under the tagline, so contrast is checked
 * per width and per theme rather than once on desktop.
 */
const AUTH_ROUTES = ["/login", "/login/forgot-password"];
const WIDTHS = [320, 360, 390, 430, 768, 1280];

test.describe("auth page text contrast", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const width of WIDTHS) {
      for (const route of AUTH_ROUTES) {
        test(`${route} at ${width}px (${scheme}) passes color-contrast`, async ({ page }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await page.setViewportSize({ width, height: 844 });
          await page.goto(route);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expect(page.locator("html")).toHaveClass(
            scheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/,
          );

          const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();

          expect(
            results.violations.flatMap((v) =>
              v.nodes.map((n) => `${n.html} :: ${n.any[0]?.message ?? ""}`),
            ),
          ).toEqual([]);
        });
      }
    }
  }
});
