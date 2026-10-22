import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AuthCard } from "./auth-card";
import { Route as ForgotPasswordRoute } from "@/routes/login/forgot-password";

/**
 * The sign-in and reset pages had no heading at all: the card title is a
 * styled <div>, so a screen reader's heading list was empty and there was no
 * way to jump to the form. Each page now exposes exactly one level-1 heading.
 */

async function render(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

/** Every element exposed as a heading, native or ARIA, with its level. */
function headings(markup: string): { level: number; text: string }[] {
  const found: { level: number; text: string }[] = [];
  for (const m of markup.matchAll(/<h([1-6])\b[^>]*>(.*?)<\/h\1>/g)) {
    found.push({ level: Number(m[1]), text: m[2].replace(/<[^>]+>/g, "") });
  }
  for (const m of markup.matchAll(/<(\w+)\b([^>]*\brole="heading"[^>]*)>(.*?)<\/\1>/g)) {
    const level = Number(m[2].match(/aria-level="(\d)"/)?.[1] ?? 2);
    found.push({ level, text: m[3].replace(/<[^>]+>/g, "") });
  }
  return found;
}

const ForgotPasswordPage = ForgotPasswordRoute.options.component as () => ReactNode;

const pages = {
  "sign-in card": { render: () => render(<AuthCard />), title: "Get Started" },
  "forgot-password page": {
    render: () => render(<ForgotPasswordPage />),
    title: "Forgot password?",
  },
};

describe.each(Object.entries(pages))("%s", (_name, page) => {
  test("has exactly one level-1 heading, and it is the card title", async () => {
    const level1 = headings(await page.render()).filter((h) => h.level === 1);
    expect(level1).toEqual([{ level: 1, text: page.title.replace("'", "&#x27;") }]);
  });
});

test("the Google icon is decorative: the button's own text names it", async () => {
  const markup = await render(<AuthCard />);
  const icon = markup.match(/<img\b[^>]*google\.svg[^>]*>/)?.[0] ?? "";
  expect(icon).not.toBe("");
  expect(icon).toContain('alt=""');
  expect(markup).toContain("Continue with Google");
});
