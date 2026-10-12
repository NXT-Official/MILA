import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { ForgotPasswordForm } from "./forgot-password-form";
import { LoginForm } from "./login-form";
import { SetNewPasswordForm } from "./set-new-password-form";
import { SignupForm } from "./signup-form";

/** The forms need a router (Link, useNavigate); render them first-paint, as the server does. */
async function render(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

const noop = () => {};
const login = () =>
  render(
    <LoginForm email="" onEmailChange={noop} showPassword={false} onToggleShowPassword={noop} />,
  );
const signup = () =>
  render(
    <SignupForm email="" onEmailChange={noop} showPassword={false} onToggleShowPassword={noop} />,
  );
const forgot = () => render(<ForgotPasswordForm />);
const setNew = () => render(<SetNewPasswordForm />);

/** The opening tag of the <input> with this id. */
function inputTag(markup: string, id: string): string {
  const tag = (markup.match(/<input\b[^>]*>/g) ?? []).find((t) => t.includes(`id="${id}"`));
  expect(tag).toBeDefined();
  return tag as string;
}

function attr(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1] ?? null;
}

const forms = { login, signup, forgot, setNew };
/** How many password inputs each form has (forgot-password has none). */
const PASSWORD_FIELDS = { login: 1, signup: 1, forgot: 0, setNew: 2 };

describe("autofill hints (WHATWG autofill field names)", () => {
  test("login: the email is the account username, the password is the current one", async () => {
    const markup = await login();

    expect(attr(inputTag(markup, "login-email"), "autocomplete")).toBe("username");
    expect(attr(inputTag(markup, "login-password"), "autocomplete")).toBe("current-password");
  });

  test("sign-up: handle is a nickname, email is an email, password is new", async () => {
    const markup = await signup();

    expect(attr(inputTag(markup, "signup-username"), "autocomplete")).toBe("nickname");
    expect(attr(inputTag(markup, "signup-email"), "autocomplete")).toBe("email");
    expect(attr(inputTag(markup, "signup-password"), "autocomplete")).toBe("new-password");
  });

  test("forgot password: the email is the account username", async () => {
    const markup = await forgot();

    expect(attr(inputTag(markup, "forgot-password-email"), "autocomplete")).toBe("username");
  });

  test("reset: both password fields are new passwords", async () => {
    const markup = await setNew();

    expect(attr(inputTag(markup, "new-password"), "autocomplete")).toBe("new-password");
    expect(attr(inputTag(markup, "confirm-new-password"), "autocomplete")).toBe("new-password");
  });
});

describe("every field has a visible label above it and no dotted placeholder", () => {
  for (const [name, renderForm] of Object.entries(forms)) {
    test(`${name}: each input is named by a label that precedes it`, async () => {
      const markup = await renderForm();
      const inputs = markup.match(/<input\b[^>]*>/g) ?? [];

      expect(inputs.length).toBeGreaterThan(0);
      for (const tag of inputs) {
        const id = attr(tag, "id");
        expect(id).not.toBeNull();
        const labelAt = markup.indexOf(`for="${id}"`);
        expect(labelAt).toBeGreaterThanOrEqual(0);
        expect(labelAt).toBeLessThan(markup.indexOf(tag));
      }
    });

    test(`${name}: no password field is dressed up as already filled in`, async () => {
      const markup = await renderForm();

      expect(markup).not.toContain("•");
      const passwordTags = markup.match(/<input\b[^>]*type="password"[^>]*>/g) ?? [];
      expect(passwordTags.length).toBe(PASSWORD_FIELDS[name as keyof typeof forms]);
      for (const tag of passwordTags) {
        // A plain hint in words, never a row of dots that looks like a saved value.
        expect(attr(tag, "placeholder") ?? "").toMatch(/^[A-Za-z][A-Za-z ]+$/);
      }
    });

    test(`${name}: our inline messages are used, not the browser's own bubbles`, async () => {
      const markup = await renderForm();

      expect(markup).toMatch(/<form\b[^>]*\bnovalidate/i);
    });
  }
});

describe("error messages on first paint", () => {
  for (const [name, renderForm] of Object.entries(forms)) {
    test(`${name}: nothing is shown or announced before the member has done anything`, async () => {
      const markup = await renderForm();

      expect(markup).not.toContain("role=");
      expect(markup).not.toContain("text-destructive");
      // Field messages are polite live regions that already exist on the page, empty.
      for (const region of markup.match(/<p\b[^>]*aria-live="polite"[^>]*><\/p>/g) ?? []) {
        expect(region).toContain("sr-only");
      }
    });
  }

  test("each field's message region is on the page from the start, so a reader hears it appear", async () => {
    expect(((await login()).match(/aria-live="polite"/g) ?? []).length).toBe(2);
    expect(((await signup()).match(/aria-live="polite"/g) ?? []).length).toBe(3);
    expect(((await forgot()).match(/aria-live="polite"/g) ?? []).length).toBe(1);
    expect(((await setNew()).match(/aria-live="polite"/g) ?? []).length).toBe(2);
  });
});

describe("copy", () => {
  for (const [name, renderForm] of Object.entries(forms)) {
    test(`${name}: no em-dash or en-dash in what members read`, async () => {
      const markup = await renderForm();

      expect(markup).not.toMatch(/[–—]/);
    });
  }
});
