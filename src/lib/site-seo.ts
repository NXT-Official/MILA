/**
 * Search and social tags for the public pages.
 *
 * The origin is never read from a request header (client-controlled). It is
 * `SITE_URL` when set and valid, else a custom production domain, else the
 * canonical live deployment from `auth-origin.ts` (see `liveOrigins`).
 * // src: @tanstack/router-core 1.170.41 route `head()` returns { meta, links }
 */
import { MILA_DEPLOYMENT_ORIGINS } from "@/lib/auth-origin";

type Env = Record<string, string | undefined>;

/** A 1200x630 crop of the landing's editorial photo. The first crop, og-image.jpg, stays in public/. */
export const OG_IMAGE_PATH = "/og-share.jpg";

/** What every page's head needs to know about the deployment serving it. */
export type SiteContext = { origin: string; indexable: boolean };

const LIVE_SITE: SiteContext = { origin: MILA_DEPLOYMENT_ORIGINS[0], indexable: true };

/** A `*.vercel.app` host is a deployment URL, never a production domain of its own. */
function isVercelAppHost(host: string): boolean {
  return host === "vercel.app" || host.endsWith(".vercel.app");
}

/**
 * The hosts allowed to be indexed, in the order that also picks the canonical
 * origin: `SITE_URL`, then a real custom production domain (a
 * `VERCEL_PROJECT_PRODUCTION_URL` that is not `*.vercel.app`), then the live
 * constant. The first present one is the canonical origin; all of them index.
 * One list for both decisions, so the canonical host is always indexable.
 * // src: https://vercel.com/docs/environment-variables/system-environment-variables
 * //      (VERCEL_PROJECT_PRODUCTION_URL: shortest production custom domain, or
 * //      the vercel.app domain when there is none)
 */
function liveOrigins(env: Env): string[] {
  const siteUrl = httpsOrigin(env.SITE_URL);
  const custom = httpsOrigin(env.VERCEL_PROJECT_PRODUCTION_URL, true);
  const customOrigin = custom && !isVercelAppHost(new URL(custom).host) ? custom : null;
  return [
    ...new Set([siteUrl, customOrigin, MILA_DEPLOYMENT_ORIGINS[0]].filter((o): o is string => !!o)),
  ];
}

/**
 * Only the live hosts may be indexed (see `liveOrigins`). Previews, nicoleDev
 * and localhost get `noindex`. `SITE_INDEXING=off` forces noindex for any
 * future test project; unset (or any other value) never turns indexing off.
 */
export function siteContext(requestHost: string, env: Env = runtimeEnv()): SiteContext {
  const off = env.SITE_INDEXING?.trim().toLowerCase() === "off";
  const hosts = liveOrigins(env).map((origin) => new URL(origin).host);
  return {
    origin: siteOrigin(env),
    indexable: !off && hosts.includes(requestHost.toLowerCase()),
  };
}

/**
 * The root loader's data, as every head() reads it from its `matches`. The
 * root match is first. Without it (never in a real render) the live defaults.
 */
export function siteFromMatches(
  matches: readonly { loaderData?: unknown }[] | undefined,
): SiteContext {
  const data = matches?.[0]?.loaderData as Partial<SiteContext> | undefined;
  return typeof data?.origin === "string" && typeof data.indexable === "boolean"
    ? { origin: data.origin, indexable: data.indexable }
    : LIVE_SITE;
}

/**
 * Load the site context once per session: it cannot change while the tab is
 * open, so a client navigation never calls the server for it.
 * // src: https://github.com/TanStack/router/blob/@tanstack/react-router@1.170.41/docs/router/api/router/RouteOptionsType.md#shouldreload-property
 * //      (`false` never reloads a loaded match) and #staleTime-property · @tanstack/react-router 1.170.41 · 2026-10-07
 * // src: node_modules/@tanstack/router-core/dist/esm/load-client.js createLoaderTask · 1.171.34
 * //      (a success match with shouldReload === false gets reload = false)
 */
export const SITE_CONTEXT_ROUTE_OPTIONS = {
  staleTime: Number.POSITIVE_INFINITY,
  shouldReload: false,
} as const;

/** og:url and the canonical link, for pages that keep their own title and description. */
export function canonicalTags(path: string, site: SiteContext) {
  const url = `${site.origin}${path}`;
  return {
    meta: [{ property: "og:url", content: url }],
    links: [{ rel: "canonical", href: url }],
  };
}

function httpsOrigin(value: string | undefined, bare = false): string | null {
  if (!value) return null;
  try {
    const url = new URL(bare ? `https://${value}` : value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** `process` does not exist in the browser bundle; the canonical constant stands in there. */
function runtimeEnv(): Env {
  return typeof process === "undefined" ? {} : process.env;
}

export function siteOrigin(env: Env = runtimeEnv()): string {
  return liveOrigins(env)[0];
}

export type PageSeo = { path: string; title: string; description: string };

/** Title, description, social tags and canonical link for one page. */
export function pageHead({ path, title, description }: PageSeo, site: SiteContext = LIVE_SITE) {
  const { origin } = site;
  const url = `${origin}${path}`;
  const image = `${origin}${OG_IMAGE_PATH}`;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/** Per-route copy for the marketing pages. No dashes: it is shown in search results. */
export const MARKETING_SEO = {
  "/how-it-works": {
    title: "How Mila works | Mila",
    description:
      "Mila reads your colors, composes the look for your day and weather, and helps you shop it. See the three steps from selfie to outfit.",
  },
  "/community": {
    title: "Community | Mila",
    description:
      "Browse real looks shared by Mila members, get ideas for your own wardrobe, and save the ones you want to try.",
  },
  "/membership": {
    title: "Membership and pricing | Mila",
    description:
      "Compare Mila plans, see what each one includes, and pick monthly or yearly. One credit buys one look.",
  },
  "/dupe-hunter": {
    title: "Dupe Hunter | Mila",
    description:
      "Found a look you love at a price you do not? Dupe Hunter finds close, affordable matches so you can get the style for less.",
  },
  "/style-dossier": {
    title: "The Style Dossier | Mila",
    description:
      "Your personal style dossier: your color season, your best silhouettes and the pieces that work for you, all in one place.",
  },
} as const satisfies Record<string, { title: string; description: string }>;

/** Every public, indexable path. Must match public/sitemap.xml. */
export const SITEMAP_PATHS = [
  "/",
  "/how-it-works",
  "/community",
  "/membership",
  "/dupe-hunter",
  "/style-dossier",
  "/privacy",
  "/terms",
] as const;
