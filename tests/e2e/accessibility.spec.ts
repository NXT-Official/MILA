import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Runtime accessibility scan for MILA's two unauthenticated public routes.
 *
 * Scope is intentionally limited to `/` and `/login`: every other route sits
 * behind Supabase session auth (see src/routes/_authenticated), which would
 * require a full login flow (and hCaptcha) to reach. Authenticated routes are
 * covered by manual a11y review instead (see Item 7 of the a11y punch list).
 */

test.describe("accessibility", () => {
  test("landing page (/) has no automatically detectable a11y violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("login page (/login) has no automatically detectable a11y violations", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("body")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
