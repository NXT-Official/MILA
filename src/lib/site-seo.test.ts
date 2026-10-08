import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { MILA_DEPLOYMENT_ORIGINS } from "@/lib/auth-origin";
import {
  MARKETING_SEO,
  OG_IMAGE_PATH,
  SITEMAP_PATHS,
  canonicalTags,
  pageHead,
  siteContext,
  siteFromMatches,
  siteOrigin,
} from "@/lib/site-seo";
import { publicAssetCacheRules } from "../../vite.config";

const read = (path: string) => readFileSync(path, "utf8");
const CANONICAL = MILA_DEPLOYMENT_ORIGINS[0];

describe("siteOrigin", () => {
  test("SITE_URL wins, normalised to a bare origin", () => {
    expect(siteOrigin({ SITE_URL: "https://mila.example/some/path/" })).toBe(
      "https://mila.example",
    );
  });

  test("an invalid SITE_URL is ignored", () => {
    expect(siteOrigin({ SITE_URL: "not a url" })).toBe(CANONICAL);
    expect(siteOrigin({ SITE_URL: "javascript:alert(1)" })).toBe(CANONICAL);
  });

  test("a custom production domain is used, a vercel.app one is not", () => {
    expect(siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "mila.example" })).toBe(
      "https://mila.example",
    );
    expect(siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "mila-nicoledev.vercel.app" })).toBe(
      CANONICAL,
    );
    expect(siteOrigin({})).toBe(CANONICAL);
  });

  test("SITE_URL beats a custom production domain", () => {
    expect(
      siteOrigin({ SITE_URL: "https://a.example", VERCEL_PROJECT_PRODUCTION_URL: "b.example" }),
    ).toBe("https://a.example");
  });
});

describe("pageHead", () => {
  const site = { origin: "https://mila.example", indexable: true };
  const head = pageHead(
    { path: "/community", title: "Community | Mila", description: "A calm place." },
    site,
  );
  const tags = head.meta as Record<string, string>[];
  const meta = (key: "name" | "property", value: string) => tags.filter((t) => t[key] === value);

  test("title, description and the social copy", () => {
    expect(tags.filter((t) => "title" in t)).toEqual([{ title: "Community | Mila" }]);
    expect(meta("name", "description")[0].content).toBe("A calm place.");
    expect(meta("property", "og:title")[0].content).toBe("Community | Mila");
    expect(meta("property", "og:description")[0].content).toBe("A calm place.");
  });

  test("og:url, og:image and the canonical link come from the site origin", () => {
    expect(meta("property", "og:url")[0].content).toBe("https://mila.example/community");
    expect(meta("property", "og:image")[0].content).toBe(`https://mila.example${OG_IMAGE_PATH}`);
    expect(meta("name", "twitter:image")[0].content).toBe(`https://mila.example${OG_IMAGE_PATH}`);
    expect(head.links).toEqual([{ rel: "canonical", href: "https://mila.example/community" }]);
  });

  test("the home path canonicalises to the origin plus a slash", () => {
    const home = pageHead(
      { path: "/", title: "t", description: "d" },
      { origin: "https://m.x", indexable: true },
    );
    expect(home.links).toEqual([{ rel: "canonical", href: "https://m.x/" }]);
  });
});

describe("siteContext: which deployments may be indexed", () => {
  const LIVE_HOST = new URL(CANONICAL).host;
  const NICOLE_ENV = { VERCEL_PROJECT_PRODUCTION_URL: "mila-nicoledev.vercel.app" };
  const NICOLE_HOST = "mila-nicoledev.vercel.app";

  test("live with no env at all is indexable and canonical to itself", () => {
    expect(siteContext(LIVE_HOST, {})).toEqual({ origin: CANONICAL, indexable: true });
    expect(siteContext(LIVE_HOST, { VERCEL_PROJECT_PRODUCTION_URL: LIVE_HOST })).toEqual({
      origin: CANONICAL,
      indexable: true,
    });
  });

  test("live plus a custom domain: both hosts index, canonical is the custom domain", () => {
    const env = { VERCEL_PROJECT_PRODUCTION_URL: "mila.example" };
    expect(siteContext("mila.example", env)).toEqual({
      origin: "https://mila.example",
      indexable: true,
    });
    expect(siteContext(LIVE_HOST, env).indexable).toBe(true);
  });

  test("nicoleDev, localhost and an empty host are not indexable", () => {
    expect(siteContext(NICOLE_HOST, NICOLE_ENV).indexable).toBe(false);
    expect(siteContext(NICOLE_HOST, {}).indexable).toBe(false);
    expect(siteContext("localhost:8080", {}).indexable).toBe(false);
    expect(siteContext("", {}).indexable).toBe(false);
  });

  test("nicoleDev canonicalises to live, never to itself", () => {
    expect(siteContext(NICOLE_HOST, NICOLE_ENV).origin).toBe(CANONICAL);
  });

  test("SITE_URL's host indexes, an unrelated vercel.app host does not", () => {
    const env = { SITE_URL: "https://mila.example" };
    expect(siteContext("mila.example", env)).toEqual({
      origin: "https://mila.example",
      indexable: true,
    });
    expect(siteContext(NICOLE_HOST, env).indexable).toBe(false);
    expect(siteContext(LIVE_HOST, env).indexable).toBe(true);
  });

  test("SITE_INDEXING=off forces noindex everywhere, any other value or none does not", () => {
    expect(siteContext(LIVE_HOST, { SITE_INDEXING: "off" }).indexable).toBe(false);
    expect(siteContext(LIVE_HOST, { SITE_INDEXING: "OFF" }).indexable).toBe(false);
    for (const value of [undefined, "", "on", "no", "false", "0"]) {
      expect(siteContext(LIVE_HOST, { SITE_INDEXING: value }).indexable).toBe(true);
    }
  });

  test("the canonical origin's own host is always indexable, so live never canonicalises to a noindexed host", () => {
    const envs = [
      {},
      { SITE_URL: "https://mila.example" },
      { VERCEL_PROJECT_PRODUCTION_URL: "mila.example" },
      { VERCEL_PROJECT_PRODUCTION_URL: "mila-nicoledev.vercel.app" },
      { SITE_URL: "https://a.example", VERCEL_PROJECT_PRODUCTION_URL: "b.example" },
    ];
    for (const env of envs) {
      const origin = siteOrigin(env);
      expect(siteContext(new URL(origin).host, env).indexable).toBe(true);
    }
  });
});

describe("siteFromMatches", () => {
  test("reads the root match's loader data", () => {
    const site = { origin: "https://a.test", indexable: false };
    expect(siteFromMatches([{ loaderData: site }, { loaderData: {} }])).toEqual(site);
  });

  test("without it, the live defaults", () => {
    expect(siteFromMatches(undefined)).toEqual({ origin: CANONICAL, indexable: true });
    expect(siteFromMatches([{ loaderData: undefined }])).toEqual({
      origin: CANONICAL,
      indexable: true,
    });
  });
});

describe("canonicalTags", () => {
  test("an og:url meta and a canonical link", () => {
    expect(canonicalTags("/privacy", { origin: "https://a.test", indexable: true })).toEqual({
      meta: [{ property: "og:url", content: "https://a.test/privacy" }],
      links: [{ rel: "canonical", href: "https://a.test/privacy" }],
    });
  });
});

describe("marketing copy", () => {
  test("every marketing route has its own title and description, with no dashes", () => {
    const entries = Object.values(MARKETING_SEO);
    expect(entries).toHaveLength(5);
    expect(new Set(entries.map((e) => e.title)).size).toBe(5);
    expect(new Set(entries.map((e) => e.description)).size).toBe(5);
    for (const { title, description } of entries) {
      expect(`${title} ${description}`).not.toMatch(/[–—]/);
      expect(description.length).toBeGreaterThan(60);
      expect(description.length).toBeLessThanOrEqual(170);
    }
  });
});

describe("public files", () => {
  test("robots.txt and sitemap.xml point at the canonical origin, not a placeholder", () => {
    const robots = read("public/robots.txt");
    const sitemap = read("public/sitemap.xml");
    expect(robots).not.toContain("example");
    expect(sitemap).not.toContain("example");
    expect(robots).toContain(`Sitemap: ${CANONICAL}/sitemap.xml`);
  });

  test("the sitemap lists every public route, and only those", () => {
    const sitemap = read("public/sitemap.xml");
    const locs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(([, loc]) => loc);
    expect(locs).toEqual(SITEMAP_PATHS.map((path) => `${CANONICAL}${path}`));
    for (const path of [
      "/how-it-works",
      "/community",
      "/membership",
      "/dupe-hunter",
      "/style-dossier",
    ]) {
      expect(SITEMAP_PATHS).toContain(path);
    }
    for (const path of SITEMAP_PATHS) expect(path).not.toMatch(/dashboard|admin|feed|login/);
  });

  test("the og image exists, is under 300 KB, and the 2 MB original is kept", () => {
    expect(statSync(`public${OG_IMAGE_PATH}`).size).toBeLessThan(300 * 1024);
    expect(existsSync("public/hero-style-sheet.png")).toBe(true);
    expect(existsSync("public/og-image.jpg")).toBe(true);
  });

  test("icons and the manifest exist and the manifest references real files", () => {
    for (const file of ["favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png"]) {
      expect(existsSync(`public/${file}`)).toBe(true);
    }
    const manifest = JSON.parse(read("public/site.webmanifest")) as {
      name: string;
      icons: { src: string }[];
    };
    expect(manifest.name).toBe("Mila");
    for (const icon of manifest.icons) expect(existsSync(`public${icon.src}`)).toBe(true);
  });

  test(".env.example documents SITE_URL and SITE_INDEXING", () => {
    expect(read(".env.example")).toMatch(/^SITE_URL=/m);
    expect(read(".env.example")).toMatch(/^# ?SITE_INDEXING=|^SITE_INDEXING=/m);
  });
});

describe("vite routeRules caching", () => {
  test("stable-name images are cached publicly with a long max-age and stale-while-revalidate", () => {
    for (const path of ["/hero-style-sheet.png", "/landing/**", OG_IMAGE_PATH]) {
      const value = publicAssetCacheRules[path]?.headers["Cache-Control"];
      expect(value).toMatch(/^public, max-age=\d{6,}, stale-while-revalidate=\d+$/);
    }
  });
});
