import { test, expect } from "@playwright/test";

const NAV_DESTINATIONS: Array<{ label: string; path: string }> = [
  { label: "How it Works", path: "/how-it-works" },
  { label: "Style Dossier", path: "/style-dossier" },
  { label: "Dupe Hunter", path: "/dupe-hunter" },
  { label: "Community", path: "/community" },
  { label: "Membership", path: "/membership" },
];

test.describe("main nav", () => {
  for (const { label, path } of NAV_DESTINATIONS) {
    test(`"${label}" nav link navigates to ${path}`, async ({ page }) => {
      await page.goto("/");
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: label })
        .click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator("h1, h2").first()).toBeVisible();
    });
  }
});
