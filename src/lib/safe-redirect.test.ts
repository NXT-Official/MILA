import { describe, expect, test } from "bun:test";
import {
  loginRedirectSearch,
  postLoginDestination,
  safeRedirect,
  validateLoginSearch,
  authCallbackUrl,
} from "./safe-redirect";

describe("safeRedirect", () => {
  test("keeps a same-origin path with its search and hash", () => {
    expect(safeRedirect("/history")).toBe("/history");
    expect(safeRedirect("/history?look=abc")).toBe("/history?look=abc");
    expect(safeRedirect("/profile/me#palette")).toBe("/profile/me#palette");
  });

  test("refuses anything that is not a string path", () => {
    expect(safeRedirect(undefined)).toBeNull();
    expect(safeRedirect(null)).toBeNull();
    expect(safeRedirect(42)).toBeNull();
    expect(safeRedirect(["/history"])).toBeNull();
    expect(safeRedirect("")).toBeNull();
    expect(safeRedirect("history")).toBeNull();
  });

  test("refuses absolute URLs on any scheme", () => {
    expect(safeRedirect("https://evil.example/steal")).toBeNull();
    expect(safeRedirect("http://evil.example")).toBeNull();
    expect(safeRedirect("javascript:alert(1)")).toBeNull();
    expect(safeRedirect("data:text/html,hi")).toBeNull();
  });

  test("refuses protocol-relative URLs", () => {
    expect(safeRedirect("//evil.example")).toBeNull();
    expect(safeRedirect("//evil.example/history")).toBeNull();
    expect(safeRedirect("///evil.example")).toBeNull();
  });

  test("refuses backslash tricks the URL parser reads as a slash", () => {
    expect(safeRedirect("/\\evil.example")).toBeNull();
    expect(safeRedirect("\\\\evil.example")).toBeNull();
    expect(safeRedirect("/\\/evil.example")).toBeNull();
    expect(safeRedirect("/history\\..\\..\\evil")).toBeNull();
  });

  test("refuses control characters a browser strips into a protocol-relative URL", () => {
    expect(safeRedirect("/\t/evil.example")).toBeNull();
    expect(safeRedirect("/\n/evil.example")).toBeNull();
    expect(safeRedirect("/\r/evil.example")).toBeNull();
    expect(safeRedirect("/\u0000/evil.example")).toBeNull();
    expect(safeRedirect("/history\u007f")).toBeNull();
  });

  test("refuses leading or trailing whitespace", () => {
    expect(safeRedirect(" /history")).toBeNull();
    expect(safeRedirect("/history ")).toBeNull();
  });

  test("refuses the sign-in and auth screens so she is never sent in a loop", () => {
    expect(safeRedirect("/login")).toBeNull();
    expect(safeRedirect("/login?redirect=%2Fhistory")).toBeNull();
    expect(safeRedirect("/login/forgot-password")).toBeNull();
    expect(safeRedirect("/auth/callback?next=/dashboard")).toBeNull();
    // A page that merely starts with the same letters is still fine.
    expect(safeRedirect("/loginhelp")).toBe("/loginhelp");
  });

  test("refuses dot segments instead of normalising them", () => {
    // Normalising is how `/.//host` turned into `//host`: a suspicious value is
    // refused, never "fixed".
    expect(safeRedirect("/history/../dashboard")).toBeNull();
    expect(safeRedirect("/../../evil.example")).toBeNull();
    expect(safeRedirect("/./history")).toBeNull();
    expect(safeRedirect("/history/.")).toBeNull();
  });

  test("refuses dot-segment tricks that normalise into a protocol-relative URL", () => {
    for (const value of [
      "/.//evil.example",
      "/%2e//evil.example",
      "/%2E//evil.example",
      "/a/..//evil.example",
      "/a/%2e%2e//evil.example",
      "/a/.%2E//evil.example",
      "/./\\evil.example",
      "/.\\/evil.example",
      "/%2e\\/evil.example",
      "/a/..\\/evil.example",
      "/.%2f%2fevil.example",
      "/.%2F%2Fevil.example",
      "/%2f/evil.example",
      "/%5c/evil.example",
      "/%5C%5Cevil.example",
      "/.//evil.example?x=1#y",
    ]) {
      expect({ value, result: safeRedirect(value) }).toEqual({ value, result: null });
    }
  });

  test("whatever it returns is a single-slash path on this site", () => {
    for (const value of [
      "/history",
      "/history?look=a%2Fb",
      "/profile/me#x",
      "/dashboard?next=//x",
    ]) {
      const result = safeRedirect(value);
      expect(result).not.toBeNull();
      expect(result!.startsWith("/")).toBe(true);
      expect(result!.startsWith("//")).toBe(false);
      expect(result!.startsWith("/\\")).toBe(false);
    }
  });

  test("refuses absurdly long values", () => {
    expect(safeRedirect(`/${"a".repeat(5000)}`)).toBeNull();
  });
});

describe("loginRedirectSearch", () => {
  test("carries the page she was on", () => {
    expect(loginRedirectSearch("/history?look=abc")).toEqual({ redirect: "/history?look=abc" });
  });

  test("drops an unsafe or missing target instead of carrying it", () => {
    expect(loginRedirectSearch("//evil.example")).toEqual({});
    expect(loginRedirectSearch(undefined)).toEqual({});
    expect(loginRedirectSearch("/login")).toEqual({});
  });
});

describe("postLoginDestination", () => {
  test("returns her to the page she asked for once her profile is complete", () => {
    expect(postLoginDestination("/dashboard", "/history")).toBe("/history");
  });

  test("onboarding always wins over the return path", () => {
    expect(postLoginDestination("/onboarding/style-profile", "/history")).toBe(
      "/onboarding/style-profile",
    );
  });

  test("falls back to the dashboard when there is no safe return path", () => {
    expect(postLoginDestination("/dashboard", undefined)).toBe("/dashboard");
    expect(postLoginDestination("/dashboard", "https://evil.example")).toBe("/dashboard");
    expect(postLoginDestination("/dashboard", "//evil.example")).toBe("/dashboard");
  });
});

describe("safeRedirect property: nothing it returns can leave the site", () => {
  test("every combination of tricky segments is refused or stays a same-origin single-slash path", () => {
    const parts = [
      ".",
      "..",
      "%2e",
      "%2E",
      ".%2e",
      "%2e%2e",
      "",
      "a",
      "%2f",
      "%5c",
      "evil.example",
    ];
    const origin = "https://app.example";
    let checked = 0;
    for (const a of parts) {
      for (const b of parts) {
        for (const c of parts) {
          for (const value of [`/${a}/${b}/${c}`, `/${a}${b}/${c}`, `/${a}/${b}${c}?q=1`]) {
            const result = safeRedirect(value);
            checked += 1;
            if (result === null) continue;
            expect(result.startsWith("/") && !result.startsWith("//")).toBe(true);
            expect(new URL(result, origin).origin).toBe(origin);
            // And what the browser would actually navigate to is unchanged by
            // a second parse: no dot segments left to collapse.
            expect(new URL(result, origin).pathname).toBe(result.split(/[?#]/)[0]);
          }
        }
      }
    }
    expect(checked).toBe(parts.length ** 3 * 3);
  });
});

describe("safeRedirect: encoded control characters", () => {
  test("refuses percent-encoded control characters anywhere in the value", () => {
    for (const value of [
      "/%09/evil.example",
      "/%0a/evil.example",
      "/%0D/evil.example",
      "/%00/evil.example",
      "/history%1F",
      "/history%7f",
      "/history?q=%0a",
      "/history#%09",
    ]) {
      expect({ value, result: safeRedirect(value) }).toEqual({ value, result: null });
    }
  });

  test("ordinary encoded characters are still fine", () => {
    expect(safeRedirect("/history?q=a%20b")).toBe("/history?q=a%20b");
    expect(safeRedirect("/history?look=a%2Fb")).toBe("/history?look=a%2Fb");
  });
});

describe("validateLoginSearch (the /login route's search validator)", () => {
  test("always overwrites the raw redirect: unsafe values become undefined, never pass through", () => {
    // router-core merges the raw search under the validated one
    // (`{ ...rawSearch, ...validated }`), so the key must always be present.
    expect(validateLoginSearch({ redirect: "//evil.example/steal" })).toEqual({
      redirect: undefined,
    });
    expect("redirect" in validateLoginSearch({})).toBe(true);
  });

  test("keeps a safe one", () => {
    expect(validateLoginSearch({ redirect: "/history?look=abc" })).toEqual({
      redirect: "/history?look=abc",
    });
  });

  test("what the router hands the page is never the raw unsafe value", async () => {
    const { createMemoryHistory, createRootRoute, createRoute, createRouter } =
      await import("@tanstack/react-router");
    const root = createRootRoute();
    const login = createRoute({
      getParentRoute: () => root,
      path: "/login",
      validateSearch: validateLoginSearch,
    });
    const router = createRouter({
      routeTree: root.addChildren([login]),
      history: createMemoryHistory({
        initialEntries: ["/login?redirect=%2F%2Fevil.example%2Fsteal"],
      }),
    });
    const matches = router.matchRoutes(router.parseLocation(router.history.location));
    const match = matches.find((m) => m.routeId === "/login");
    expect(match).toBeDefined();
    expect((match?.search as { redirect?: unknown }).redirect).toBeUndefined();

    // Control: a validator that returns {} (the old one) leaks the raw value.
    const leakyRoot = createRootRoute();
    const leaky = createRoute({
      getParentRoute: () => leakyRoot,
      path: "/leaky",
      validateSearch: () => ({}),
    });
    const leakyRouter = createRouter({
      routeTree: leakyRoot.addChildren([leaky]),
      history: createMemoryHistory({ initialEntries: ["/leaky?redirect=%2F%2Fevil.example"] }),
    });
    const leakyMatch = leakyRouter
      .matchRoutes(leakyRouter.parseLocation(leakyRouter.history.location))
      .find((m) => m.routeId === "/leaky");
    expect((leakyMatch?.search as { redirect?: unknown }).redirect).toBe("//evil.example");
  });
});

describe("authCallbackUrl (where Supabase sends her back after an email link or Google)", () => {
  test("returns to the deployment she is on, carrying her safe return path", () => {
    expect(authCallbackUrl("https://mila-nicoledev.vercel.app", "/history?look=abc")).toBe(
      "https://mila-nicoledev.vercel.app/auth/callback?next=%2Fhistory%3Flook%3Dabc",
    );
  });

  test("no return path, or an unsafe one: the dashboard", () => {
    expect(authCallbackUrl("https://mila.example", undefined)).toBe(
      "https://mila.example/auth/callback?next=%2Fdashboard",
    );
    expect(authCallbackUrl("https://mila.example", "//evil.example")).toBe(
      "https://mila.example/auth/callback?next=%2Fdashboard",
    );
  });

  test("uses only the origin of what it is given", () => {
    expect(authCallbackUrl("https://mila.example/some/page?x=1", "/history")).toBe(
      "https://mila.example/auth/callback?next=%2Fhistory",
    );
  });
});
