import { test, expect, type Page } from "@playwright/test";

/**
 * Interaction checks for the auth forms. The unit tests render the forms to
 * static markup, which cannot see focus, so this is where "leave a field and
 * the message appears under it" is actually exercised.
 *
 * Nothing here submits: sign-in and sign-up sit behind hCaptcha.
 */

/** React attaches its props to a node when it hydrates; until then, blur does nothing. */
async function hydrated(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((key) => key.startsWith("__reactProps"));
  }, selector);
}

/** Leaves the focused field the way a member does. */
async function leave(page: Page, selector: string) {
  await page.focus(selector);
  await page.keyboard.press("Tab");
}

async function expectMessageUnder(page: Page, inputId: string, errorId: string, text: string) {
  const input = page.locator(`#${inputId}`);
  const error = page.locator(`#${errorId}`);

  await expect(error).toHaveText(text);
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute("aria-describedby", new RegExp(`\\b${errorId}\\b`));
  // Polite, so it does not interrupt typing; never an assertive alert.
  await expect(error).toHaveAttribute("aria-live", "polite");
  await expect(error).not.toHaveAttribute("role", "alert");

  // Label above the input, message below it. Measured in one step: the page can still
  // be shifting (the captcha loads in), so three separate measurements would disagree.
  const order = await page.evaluate(
    ({ inputId, errorId }) => {
      const bottom = (el: Element | null) => el?.getBoundingClientRect().bottom ?? NaN;
      const top = (el: Element | null) => el?.getBoundingClientRect().top ?? NaN;
      const label = document.querySelector(`label[for="${inputId}"]`);
      const field = document.getElementById(inputId);
      const message = document.getElementById(errorId);
      return {
        labelAboveField: bottom(label) <= top(field),
        messageBelowField: bottom(field) <= top(message),
      };
    },
    { inputId, errorId },
  );
  expect(order).toEqual({ labelAboveField: true, messageBelowField: true });
}

async function expectNoMessage(page: Page, inputId: string, errorId: string) {
  await expect(page.locator(`#${errorId}`)).toHaveText("");
  await expect(page.locator(`#${inputId}`)).not.toHaveAttribute("aria-invalid", "true");
}

test.describe("log in form", () => {
  test("leaving a field shows what is wrong under it, and fixing it clears the message", async ({
    page,
  }) => {
    await page.goto("/login");
    await hydrated(page, "#login-email");

    await expect(page.locator("#login-email")).toHaveAttribute("autocomplete", "username");
    await expect(page.locator("#login-password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await expectNoMessage(page, "login-email", "login-email-error");

    await leave(page, "#login-email");
    await expectMessageUnder(page, "login-email", "login-email-error", "Enter your email address.");

    await page.fill("#login-email", "nicole");
    await expectMessageUnder(
      page,
      "login-email",
      "login-email-error",
      "Enter a valid email address.",
    );

    await page.fill("#login-email", "nicole@example.com");
    await expectNoMessage(page, "login-email", "login-email-error");

    await leave(page, "#login-password");
    await expectMessageUnder(
      page,
      "login-password",
      "login-password-error",
      "Enter your password.",
    );
  });
});

test.describe("sign up form", () => {
  test("holds the password to the checklist on blur and says what is missing", async ({ page }) => {
    await page.goto("/login");
    await hydrated(page, "#login-email");
    // The tab's handler can still be attaching when the first click lands, so click until it takes.
    const signUpTab = page.getByRole("tab", { name: "Sign Up" });
    await expect(async () => {
      await signUpTab.click();
      await expect(signUpTab).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
    }).toPass();
    await hydrated(page, "#signup-username");

    await expect(page.locator("#signup-username")).toHaveAttribute("autocomplete", "nickname");
    await expect(page.locator("#signup-email")).toHaveAttribute("autocomplete", "email");
    await expect(page.locator("#signup-password")).toHaveAttribute("autocomplete", "new-password");

    await page.fill("#signup-username", "ab");
    await leave(page, "#signup-username");
    await expectMessageUnder(
      page,
      "signup-username",
      "signup-username-error",
      "Username must be at least 3 characters.",
    );

    await page.fill("#signup-password", "short");
    await leave(page, "#signup-password");
    await expectMessageUnder(
      page,
      "signup-password",
      "signup-password-error",
      "Still needed: at least 12 characters, one uppercase letter, one digit, one symbol.",
    );
    await expect(page.locator("#signup-password")).toHaveAttribute(
      "aria-describedby",
      /signup-password-requirements/,
    );

    await page.fill("#signup-password", "Abcdefghij1!");
    await expectNoMessage(page, "signup-password", "signup-password-error");
  });
});

test.describe("forgot password form", () => {
  test("asks for the address when it is left empty", async ({ page }) => {
    await page.goto("/login/forgot-password");
    await hydrated(page, "#forgot-password-email");

    await expect(page.locator("#forgot-password-email")).toHaveAttribute(
      "autocomplete",
      "username",
    );

    await leave(page, "#forgot-password-email");
    await expectMessageUnder(
      page,
      "forgot-password-email",
      "forgot-password-email-error",
      "Enter your email address.",
    );
  });
});

test.describe("set a new password form", () => {
  // The page only shows the form to someone holding a reset session, so the
  // test plants a stub one. supabase-js keys its storage by the project ref,
  // which comes from VITE_SUPABASE_URL; without it there is no key to plant.
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  test.skip(!supabaseUrl, "needs VITE_SUPABASE_URL in the environment to plant a stub session");

  test("rechecks the confirmation when the new password changes", async ({ page }) => {
    const ref = new URL(supabaseUrl!).hostname.split(".")[0];
    await page.addInitScript((storageKey) => {
      const b64 = (value: object) =>
        btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const id = "00000000-0000-0000-0000-000000000001";
      const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, exp, role: "authenticated" })}.sig`;
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: token,
          refresh_token: "stub",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: exp,
          user: {
            id,
            aud: "authenticated",
            role: "authenticated",
            email: "stub@example.com",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          },
        }),
      );
    }, `sb-${ref}-auth-token`);

    await page.goto("/auth/reset-password");
    await hydrated(page, "#new-password");

    await expect(page.locator("#new-password")).toHaveAttribute("autocomplete", "new-password");
    await expect(page.locator("#confirm-new-password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );

    await page.fill("#new-password", "Abcdefghij1!");
    await page.fill("#confirm-new-password", "Abcdefghij1");
    await leave(page, "#confirm-new-password");
    await expectMessageUnder(
      page,
      "confirm-new-password",
      "confirm-new-password-error",
      "Passwords do not match.",
    );

    // Editing the new password to match must not leave the old verdict on screen.
    await page.fill("#new-password", "Abcdefghij1");
    await expect(page.locator("#confirm-new-password-error")).toHaveText("");
  });
});
