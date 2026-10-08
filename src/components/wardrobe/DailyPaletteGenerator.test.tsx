import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { AuthContext } from "@/hooks/use-auth";
import { queryKeys } from "@/constants/query-keys";
import type { DashboardProfile } from "@/lib/queries/profile";
import { DailyPaletteGenerator } from "./DailyPaletteGenerator";

const USER = { id: "member-1" } as User;

const OWN_COLORS = {
  primarySwatches: [
    { hex: "#8B4513", name: "Saddle Brown" },
    { hex: "#C19A6B", name: "Camel" },
    { hex: "#556B2F", name: "Olive" },
    { hex: "#B7410E", name: "Rust" },
  ],
  secondarySwatches: [{ hex: "#36454F", name: "Charcoal" }],
};

function profile(colorProfile: unknown): DashboardProfile {
  return { color_season: "Soft Autumn", color_profile: colorProfile } as DashboardProfile;
}

async function render(data: DashboardProfile | null, failed = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  if (data) client.setQueryData(queryKeys.profile(USER.id), data);
  if (failed) {
    client
      .getQueryCache()
      .build(client, { queryKey: queryKeys.profile(USER.id) })
      .setState({ status: "error", error: new Error("offline"), fetchStatus: "idle" });
  }
  const rootRoute = createRootRoute({
    component: () => (
      <AuthContext.Provider
        value={{
          user: USER,
          session: null,
          loading: false,
          signingOut: false,
          signOut: async () => {},
        }}
      >
        <QueryClientProvider client={client}>
          <DailyPaletteGenerator userColorSeason="Soft Autumn" />
        </QueryClientProvider>
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

describe("DailyPaletteGenerator", () => {
  test("Base, Statement, Accent with wear lines; Mila's take: with no dash", async () => {
    const markup = await render(profile(OWN_COLORS));
    for (const text of ["Base", "Statement", "Accent"]) expect(markup).toContain(text);
    for (const line of ["Bottoms or a jacket", "Top, near your face", "Shoes, bag or jewelry"]) {
      expect(markup).toContain(line);
    }
    expect(markup).toContain("From your colors");
    expect(markup).toContain("Mila&#x27;s take:");
    expect(markup).not.toMatch(/[–—]/);
    expect(markup).not.toContain("Read my colors");
    // Her own colours only: every swatch dot is one of her hexes.
    const dots = [...markup.matchAll(/background-color:\s*(#[0-9A-Fa-f]{6})/g)].map((m) =>
      m[1]!.toUpperCase(),
    );
    expect(dots.length).toBe(3);
    for (const hex of dots) {
      expect(["#8B4513", "#C19A6B", "#556B2F", "#B7410E", "#36454F"]).toContain(hex);
    }
  });

  test("curated mix and Read my colors without a read", async () => {
    const markup = await render(profile(null));
    expect(markup).toContain("Palettes from your own colors start after your color read.");
    expect(markup).toContain("Read my colors");
    expect(markup).toContain('href="/style-profile"');
    expect(markup).toContain("Bottoms or a jacket");
    expect(markup).not.toContain("From your colors</span>");
    expect(markup).not.toMatch(/[–—]/);
  });

  test("two swatches are not enough for a trio", async () => {
    const markup = await render(
      profile({ primarySwatches: OWN_COLORS.primarySwatches.slice(0, 2) }),
    );
    expect(markup).toContain("Read my colors");
  });

  test("a skeleton of three circles while the profile loads", async () => {
    const markup = await render(null);
    expect(markup).toContain('aria-label="Loading your colors"');
    expect(markup.match(/data-palette-skeleton/g)?.length).toBe(3);
    expect(markup).not.toContain("Statement");
  });

  test("a polite live region is ready for the shuffle announcement", async () => {
    const markup = await render(profile(OWN_COLORS));
    expect(markup).toMatch(/aria-live="polite"/);
    expect(markup).not.toContain("New palette:");
  });

  test("an unreadable profile says so, with a retry, and never claims she has no read", async () => {
    const markup = await render(null, true);
    expect(markup).toContain("We couldn&#x27;t load your colors. Try again.");
    expect(markup).toMatch(/<button[^>]*>[^<]*Try again/);
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("start after your color read");
    expect(markup).not.toContain("Read my colors");
    expect(markup).not.toContain("Loading your colors");
  });

  test("the Read my colors link is at least 44px tall", async () => {
    const markup = await render(profile(null));
    const link = markup.match(/<a[^>]*>\s*Read my colors/)?.[0] ?? "";
    expect(link).toContain("min-h-11");
  });
});
