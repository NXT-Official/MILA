import { describe, expect, test } from "bun:test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  ACCOUNT_SECTIONS,
  planSectionChange,
  sanitizeAccountSection,
  validateAccountSearch,
  type AccountSection,
} from "./account-sections";

describe("sanitizeAccountSection", () => {
  test("accepts every real section id", () => {
    for (const { id } of ACCOUNT_SECTIONS) expect(sanitizeAccountSection(id)).toBe(id);
  });

  test("anything else falls back to nothing, so the list shows", () => {
    for (const bad of [
      "",
      "Security",
      "security ",
      "billing",
      "__proto__",
      "constructor",
      undefined,
      null,
      0,
      true,
      {},
      ["security"],
    ]) {
      expect(sanitizeAccountSection(bad)).toBeUndefined();
    }
  });
});

describe("validateAccountSearch", () => {
  test("keeps a valid section", () => {
    expect(validateAccountSearch({ section: "security" })).toEqual({ section: "security" });
  });

  test("drops an unknown or malformed section instead of throwing", () => {
    expect(validateAccountSearch({ section: "nope" })).toEqual({});
    expect(validateAccountSearch({ section: ["security"] })).toEqual({});
    expect(validateAccountSearch({})).toEqual({});
  });

  test("ignores unrelated search params", () => {
    expect(validateAccountSearch({ section: "privacy", utm_source: "mail" })).toEqual({
      section: "privacy",
    });
  });
});

describe("the section in the URL", () => {
  // The same validateSearch the /account route uses, in a real router with
  // in-memory history, read the way the page reads it.
  async function sectionFor(url: string) {
    const root = createRootRoute();
    const account = createRoute({
      getParentRoute: () => root,
      path: "/account",
      validateSearch: validateAccountSearch,
    });
    const router = createRouter({
      routeTree: root.addChildren([account]),
      history: createMemoryHistory({ initialEntries: [url] }),
    });
    await router.load();
    const search = router.state.matches.find((m) => m.routeId === "/account")?.search as
      { section?: unknown } | undefined;
    return search?.section;
  }

  test("a link to a section opens it", async () => {
    expect(sanitizeAccountSection(await sectionFor("/account?section=security"))).toBe("security");
  });

  test("no section, or a bad one, lands on the list", async () => {
    expect(sanitizeAccountSection(await sectionFor("/account"))).toBeUndefined();
    expect(sanitizeAccountSection(await sectionFor("/account?section=bogus"))).toBeUndefined();
  });

  test("the router merges raw params into the match, so an unknown id can still arrive as a string", async () => {
    // Documented because it is why the page sanitizes what useSearch() hands it
    // instead of trusting validateSearch alone.
    expect(await sectionFor("/account?section=bogus")).toBe("bogus");
  });
});

describe("planSectionChange", () => {
  test("list to a section on phone or tablet is the one history push", () => {
    expect(planSectionChange(null, "security", { wide: false, cameFromList: false })).toEqual({
      kind: "navigate",
      section: "security",
      replace: false,
      cameFromList: true,
    });
  });

  test("moving between sections replaces, so one Back always returns to the list", () => {
    expect(
      planSectionChange("preferences", "location", { wide: false, cameFromList: true }),
    ).toEqual({ kind: "navigate", section: "location", replace: true, cameFromList: true });
    // reached by a deep link: nothing behind it to go back to, still no extra entry
    expect(
      planSectionChange("preferences", "location", { wide: false, cameFromList: false }),
    ).toEqual({ kind: "navigate", section: "location", replace: true, cameFromList: false });
  });

  test("on desktop every change replaces and never counts as coming from the list", () => {
    expect(planSectionChange(null, "privacy", { wide: true, cameFromList: false })).toEqual({
      kind: "navigate",
      section: "privacy",
      replace: true,
      cameFromList: false,
    });
    expect(planSectionChange("security", "privacy", { wide: true, cameFromList: true })).toEqual({
      kind: "navigate",
      section: "privacy",
      replace: true,
      cameFromList: false,
    });
  });

  test("in-page Back is a real history Back when the entry behind is the list", () => {
    expect(planSectionChange("location", null, { wide: false, cameFromList: true })).toEqual({
      kind: "history-back",
      cameFromList: false,
    });
  });

  test("in-page Back from a deep link replaces with the list instead", () => {
    expect(planSectionChange("security", null, { wide: false, cameFromList: false })).toEqual({
      kind: "navigate",
      section: null,
      replace: true,
      cameFromList: false,
    });
  });

  test("list, then Preferences, then Location: still exactly one Back to the list", () => {
    let ctx = { wide: false, cameFromList: false };
    let at: AccountSection | null = null;
    const steps: Array<AccountSection | null> = ["preferences", "location", "preferences"];
    let pushes = 0;
    for (const next of steps) {
      const plan = planSectionChange(at, next, ctx);
      if (plan.kind === "navigate" && !plan.replace) pushes += 1;
      at = next;
      ctx = { ...ctx, cameFromList: plan.cameFromList };
    }
    expect(pushes).toBe(1);
    expect(planSectionChange(at, null, ctx).kind).toBe("history-back");
  });
});
