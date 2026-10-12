import { describe, expect, test } from "bun:test";
import { notFound, redirect } from "@tanstack/react-router";
import { createSiteContextLoader } from "@/lib/site-context.loader";

const SITE = { origin: "https://a.test", indexable: true };

describe("createSiteContextLoader", () => {
  test("returns what the server function returns", async () => {
    expect(await createSiteContextLoader(async () => SITE)()).toEqual(SITE);
  });

  test("a failed call is swallowed: undefined, so heads fall back, not an error page", async () => {
    const load = createSiteContextLoader(async () => {
      throw new Error("server function unreachable");
    });
    expect(await load()).toBeUndefined();
  });

  test("redirects and not-founds are the router's control flow and pass through", async () => {
    const redirected = createSiteContextLoader(async () => {
      throw redirect({ to: "/login" });
    });
    await expect(redirected()).rejects.toMatchObject({ options: { to: "/login" } });
    const missing = createSiteContextLoader(async () => {
      throw notFound();
    });
    await expect(missing()).rejects.toMatchObject({ isNotFound: true });
  });

  test("in a browser, a later failure keeps the context it already loaded", async () => {
    let fail = false;
    const load = createSiteContextLoader(
      async () => {
        if (fail) throw new Error("offline");
        return SITE;
      },
      () => true,
    );
    expect(await load()).toEqual(SITE);
    fail = true;
    expect(await load()).toEqual(SITE);
  });

  test("on the server nothing is remembered between requests", async () => {
    let fail = false;
    const load = createSiteContextLoader(
      async () => {
        if (fail) throw new Error("boom");
        return SITE;
      },
      () => false,
    );
    expect(await load()).toEqual(SITE);
    fail = true;
    expect(await load()).toBeUndefined();
  });
});
