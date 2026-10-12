import { describe, expect, test } from "bun:test";
import { Route as CommunityRoute } from "./community";
import { Route as DupeHunterRoute } from "./dupe-hunter";
import { Route as HowItWorksRoute } from "./how-it-works";
import { Route as MembershipRoute } from "./membership";
import { Route as RootRoute } from "./__root";
import { Route as StyleDossierRoute } from "./style-dossier";
import { MARKETING_SEO, siteOrigin } from "@/lib/site-seo";

type Tag = Record<string, string>;
type HeadResult = { meta?: Tag[]; links?: Tag[] };
type AnyHead = (ctx: never) => HeadResult | Promise<HeadResult>;

const ROUTES = [
  { path: "/how-it-works", route: HowItWorksRoute },
  { path: "/community", route: CommunityRoute },
  { path: "/membership", route: MembershipRoute },
  { path: "/dupe-hunter", route: DupeHunterRoute },
  { path: "/style-dossier", route: StyleDossierRoute },
] as const;

describe("marketing route heads", () => {
  for (const { path, route } of ROUTES) {
    test(`${path} has its own title and description, canonical and og tags`, async () => {
      const head = await (route.options.head as AnyHead)({} as never);
      const meta = head.meta ?? [];
      const seo = MARKETING_SEO[path];
      expect(meta.find((t) => "title" in t)?.title).toBe(seo.title);
      expect(meta.find((t) => t.name === "description")?.content).toBe(seo.description);
      expect(meta.find((t) => t.property === "og:url")?.content).toBe(`${siteOrigin()}${path}`);
      expect(meta.find((t) => t.property === "og:image")?.content).toContain("/og-share.jpg");
      expect(head.links).toContainEqual({ rel: "canonical", href: `${siteOrigin()}${path}` });
    });
  }
});

describe("root head", () => {
  test("declares the favicon set, apple-touch icon, manifest and an og:image", async () => {
    const head = await (RootRoute.options.head as AnyHead)({} as never);
    const hrefs = (head.links ?? []).map((l) => l.href);
    expect(hrefs).toContain("/favicon.ico");
    expect(hrefs).toContain("/apple-touch-icon.png");
    expect(hrefs).toContain("/site.webmanifest");
    expect(hrefs).toContain("/favicon.svg");
    const meta = head.meta ?? [];
    expect(meta.find((t) => t.property === "og:image")?.content).toContain("/og-share.jpg");
    expect(meta.find((t) => t.name === "twitter:card")?.content).toBe("summary_large_image");
    expect(meta.filter((t) => t.name === "description")).toHaveLength(1);
  });
});
