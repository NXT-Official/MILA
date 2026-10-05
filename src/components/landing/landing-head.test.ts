import { describe, expect, test } from "bun:test";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HeadContent,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { LandingContent } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { Route as RootRoute } from "@/routes/__root";
import { Route as HomeRoute } from "@/routes/index";

type HomeHead = NonNullable<typeof HomeRoute.options.head>;
type RootHead = NonNullable<typeof RootRoute.options.head>;
type MetaTag = { title?: string; name?: string; property?: string; content?: string };

/** The four tags under test, each as the list of values found for it. */
type SeoTags = {
  title: string[];
  description: string[];
  ogTitle: string[];
  ogDescription: string[];
};

/** Copy as it appears in the markup: React escapes quotes, ampersands and angle brackets. */
function text(copy: string) {
  return renderToStaticMarkup(createElement(Fragment, null, copy));
}

function seoTags(meta: MetaTag[]): SeoTags {
  const contents = (key: "name" | "property", value: string) =>
    meta.filter((tag) => tag[key] === value).map((tag) => tag.content ?? "");
  return {
    title: meta.flatMap((tag) => (tag.title === undefined ? [] : [tag.title])),
    description: contents("name", "description"),
    ogTitle: contents("property", "og:title"),
    ogDescription: contents("property", "og:description"),
  };
}

function escaped(tags: SeoTags): SeoTags {
  return {
    title: tags.title.map(text),
    description: tags.description.map(text),
    ogTitle: tags.ogTitle.map(text),
    ogDescription: tags.ogDescription.map(text),
  };
}

/** The home route's own `head`, called the way the router calls it. */
async function homeHead(loaderData: LandingContent | undefined) {
  const head = HomeRoute.options.head as HomeHead;
  return head({ loaderData } as Parameters<HomeHead>[0]);
}

/** The root route's own `head`: the defaults every page starts from. */
async function rootHead() {
  const head = RootRoute.options.head as RootHead;
  return head({} as Parameters<RootHead>[0]);
}

function metaOf(head: { meta?: unknown[] }): MetaTag[] {
  return (head.meta ?? []).filter((tag) => tag !== undefined) as MetaTag[];
}

/**
 * The document `<head>` as a visitor's browser receives it: the real root
 * route's defaults merged with the real home route's tags by the router's own
 * HeadContent. Values are returned as they appear in the markup (escaped).
 */
async function documentSeoTags(loaderData: LandingContent | undefined): Promise<SeoTags> {
  const rootRoute = createRootRoute({
    head: () => rootHead(),
    component: () => createElement(HeadContent),
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => loaderData,
    head: (ctx) => homeHead(ctx.loaderData),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const markup = renderToStaticMarkup(createElement(RouterProvider<typeof router>, { router }));

  const titles = [...markup.matchAll(/<title>(.*?)<\/title>/gs)].map(([, inner]): MetaTag => ({
    title: inner,
  }));
  const metas = [...markup.matchAll(/<meta\b[^>]*>/g)].map(([tag]): MetaTag => ({
    name: tag.match(/ name="([^"]*)"/)?.[1],
    property: tag.match(/ property="([^"]*)"/)?.[1],
    content: tag.match(/ content="([^"]*)"/)?.[1],
  }));
  return seoTags([...titles, ...metas]);
}

/** SEO copy the fallback (and so the root defaults) does not contain. */
const EDITED: LandingContent = {
  ...LANDING_FALLBACK,
  seo: {
    ...LANDING_FALLBACK.seo,
    title: 'Edited title — it\'s "new" & improved',
    description: "Edited description",
    socialDescription: "Edited social description",
  },
};
const FROM_SEO: SeoTags = {
  title: [EDITED.seo.title],
  description: [EDITED.seo.description],
  ogTitle: [EDITED.seo.title],
  ogDescription: [EDITED.seo.socialDescription],
};

describe("home route head", () => {
  test("title, description, og:title and og:description come from seo, exactly one of each", async () => {
    expect(seoTags(metaOf(await homeHead(EDITED)))).toEqual(FROM_SEO);
  });

  test("without loader data the route adds no tags of its own", async () => {
    expect(await homeHead(undefined)).toEqual({});
  });
});

describe("home page <head>, root defaults merged with the home route", () => {
  test("exactly one title, description, og:title and og:description: the Studio's", async () => {
    expect(await documentSeoTags(EDITED)).toEqual(escaped(FROM_SEO));
  });

  test("without loader data: still exactly one of each, the root defaults", async () => {
    const defaults = seoTags(metaOf(await rootHead()));
    // Guard: the root declares each of the four tags once.
    expect(Object.values(defaults).map((values) => values.length)).toEqual([1, 1, 1, 1]);

    expect(await documentSeoTags(undefined)).toEqual(escaped(defaults));
  });
});
