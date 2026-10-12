import { describe, expect, test } from "bun:test";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { Route as RootRoute } from "./__root";

type Tag = Record<string, string>;
type HeadFn = (ctx: never) => { meta?: Tag[] } | Promise<{ meta?: Tag[] }>;

/** The root's own tags: the defaults any page without its own head shows (the /login tab, for one). */
async function rootMeta() {
  const head = await (RootRoute.options.head as HeadFn)({ loaderData: undefined } as never);
  return head.meta ?? [];
}

describe("the root head defaults speak the landing's copy", () => {
  test("title and descriptions are the checked-in landing SEO copy", async () => {
    const meta = await rootMeta();
    const content = (key: "name" | "property", value: string) =>
      meta.find((tag) => tag[key] === value)?.content;
    expect(meta.find((tag) => "title" in tag)?.title).toBe(LANDING_FALLBACK.seo.title);
    expect(content("property", "og:title")).toBe(LANDING_FALLBACK.seo.title);
    expect(content("name", "description")).toBe(LANDING_FALLBACK.seo.description);
    expect(content("property", "og:description")).toBe(LANDING_FALLBACK.seo.socialDescription);
  });

  test("no em or en dash and no UK spelling in any default", async () => {
    const values = (await rootMeta()).flatMap((tag) => [tag.title, tag.content]).filter(Boolean);
    // Guard: the defaults were read.
    expect(values.length).toBeGreaterThan(5);
    expect(values.filter((v) => /[–—]|\bcolour/i.test(v))).toEqual([]);
  });
});
