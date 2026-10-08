import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AuthContext } from "@/hooks/use-auth";
import { NotFoundPage } from "@/components/layout/not-found-page";
import { LegalPage } from "./legal-page";

async function render(node: React.ReactNode) {
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
        {node}
      </AuthContext.Provider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider<typeof router> router={router} />);
}

describe("page chrome", () => {
  test("legal pages carry the site header and footer around the policy", async () => {
    const markup = await render(
      <LegalPage title="Privacy Policy">
        <p>Body copy</p>
      </LegalPage>,
    );
    expect(markup).toMatch(/<header\b/);
    expect(markup).toMatch(/<footer\b/);
    expect(markup).toContain('aria-label="Legal"');
    expect(markup).toContain("Privacy Policy");
    expect(markup).toContain("Body copy");
    expect(markup).toMatch(/<main\b/);
  });

  test("the 404 page carries the header and footer, a way home, and no dashes", async () => {
    const markup = await render(<NotFoundPage />);
    expect(markup).toMatch(/<header\b/);
    expect(markup).toMatch(/<footer\b/);
    expect(markup).toContain("Page not found");
    expect(markup).toContain('href="/"');
    expect(markup).not.toMatch(/[–—]/);
  });
});
