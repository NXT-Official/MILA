import posthog from "posthog-js";
import type { BeforeSendFn, CaptureResult } from "posthog-js";

/** What `sanitizeUrl` returns for input it cannot parse: never the raw string. */
export const UNPARSEABLE_URL = "[unparseable-url]";

// ALLOWLIST: the only query params analytics may keep. Everything else is
// dropped, so a new auth provider's param, a free-text search (?q=) or an
// address can never leak by being absent from a denylist.
const ALLOWED_PARAMS: ReadonlySet<string> = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "page",
  "tab",
  "section",
  "view",
  "sort",
]);

const MAX_DECODE_ROUNDS = 5;

// Percent-decodes (and turns `+` into a space) until the text stops changing,
// so `%2563ode` cannot hide as `%63ode`. Returns null when it cannot settle or
// is malformed: the caller drops what it cannot read.
function decodeToFixedPoint(raw: string): string | null {
  let current = raw;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current.replace(/\+/g, " "));
    } catch {
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  return null;
}

// A run of 20+ letters/digits (hex, base64url body) or a JWT shape.
const TOKEN_RUN = /[A-Za-z0-9]{20,}/;
const JWT_SHAPE = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/;
const SAFE_VALUE = /^[A-Za-z0-9 _.,-]{0,64}$/;

// A kept param's value must be short, plain text. Anything with `=`, `&`, `/`,
// `:` or `@` (a nested query, URL or address) or that looks like a token goes.
function isSafeValue(value: string): boolean {
  return SAFE_VALUE.test(value) && !TOKEN_RUN.test(value) && !JWT_SHAPE.test(value);
}

function sanitizeQuery(search: string): string {
  const kept: string[] = [];
  for (const pair of search.replace(/^\?/, "").split(/[&;]/)) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const name = decodeToFixedPoint(eq === -1 ? pair : pair.slice(0, eq))
      ?.trim()
      .toLowerCase();
    if (!name || !ALLOWED_PARAMS.has(name)) continue;
    if (eq === -1) {
      kept.push(name);
      continue;
    }
    const value = decodeToFixedPoint(pair.slice(eq + 1));
    if (value === null || !isSafeValue(value)) continue;
    kept.push(`${name}=${encodeURIComponent(value)}`);
  }
  return kept.length > 0 ? `?${kept.join("&")}` : "";
}

const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{20,}$/;
const PLACEHOLDER_SEGMENT = ":token";

// A path segment that looks like a credential (base64url/hex of 20+, or a JWT),
// or hides query/fragment syntax behind percent-encoding, becomes `:token`.
function sanitizeSegment(segment: string): string {
  if (segment === "") return segment;
  const decoded = decodeToFixedPoint(segment);
  if (decoded === null || /[#?=&;]/.test(decoded)) return PLACEHOLDER_SEGMENT;
  if (TOKEN_SEGMENT.test(decoded) || JWT_SHAPE.test(decoded)) return PLACEHOLDER_SEGMENT;
  return segment;
}

function sanitizePath(pathname: string): string {
  return pathname.split("/").map(sanitizeSegment).join("/");
}

function isAuthPath(pathname: string): boolean {
  const first = pathname.split("/")[1] ?? "";
  return (decodeToFixedPoint(first) ?? first).trim().toLowerCase() === "auth";
}

/**
 * Reduces a URL to what analytics may keep: origin (or scheme://host), the
 * path with credential-looking segments replaced by `:token`, and only the
 * allowlisted query params with plain values. The fragment is always dropped,
 * and so is the whole query on `/auth/*` pages and `mila://auth*` deep links.
 * Embedded credentials (userinfo) are dropped. Accepts absolute URLs (including
 * custom schemes such as `mila://auth/callback`) and bare paths; anything else
 * becomes UNPARSEABLE_URL.
 */
export function sanitizeUrl(url: string): string {
  try {
    if (url.startsWith("/") && !url.startsWith("//")) {
      // The base only lets the parser accept a bare path; it is never emitted.
      const path = new URL(url, "https://path.invalid");
      const query = isAuthPath(path.pathname) ? "" : sanitizeQuery(path.search);
      return `${sanitizePath(path.pathname)}${query}`;
    }
    const parsed = new URL(url);
    if (parsed.host === "") return UNPARSEABLE_URL;
    const webScheme = parsed.protocol === "http:" || parsed.protocol === "https:";
    // For `mila://auth/callback` the host is `auth`: the same auth surface.
    const auth = webScheme
      ? isAuthPath(parsed.pathname)
      : parsed.host.toLowerCase().startsWith("auth");
    const host = webScheme ? parsed.host : sanitizeSegment(parsed.host);
    const query = auth ? "" : sanitizeQuery(parsed.search);
    return `${parsed.protocol}//${host}${sanitizePath(parsed.pathname)}${query}`;
  } catch {
    return UNPARSEABLE_URL;
  }
}

// Event properties that hold a page URL, referrer or path. The first five are
// what autocapture, pageleave and `$pageview` send; the rest are derived by the
// SDK from the same location (session entry) or from an outbound click.
const URL_PROPERTY_KEYS = [
  "$current_url",
  "$referrer",
  "$pathname",
  "$initial_current_url",
  "$initial_referrer",
  "$initial_pathname",
  "$session_entry_url",
  "$session_entry_referrer",
  "$session_entry_pathname",
  "$external_click_url",
] as const;

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// "" has nothing to leak; "$direct" is PostHog's sentinel for "no referrer",
// not a URL, and must survive so direct traffic stays distinguishable.
function scrubValue(value: unknown): unknown {
  if (typeof value !== "string" || value === "" || value === "$direct") return value;
  return sanitizeUrl(value);
}

function scrubUrlKeys(bag: Bag): Bag {
  const out: Bag = { ...bag };
  for (const key of URL_PROPERTY_KEYS) {
    if (key in out) out[key] = scrubValue(out[key]);
  }
  return out;
}

// `$elements_chain` serializes autocaptured elements as `tag.class:key="value"…`
// and repeats a link's target as both `attr__href="…"` and `href="…"`.
const HREF_IN_CHAIN = /([:"](?:attr__)?href=")((?:[^"\\]|\\.)*)/g;

function scrubElementsChain(chain: string): string {
  return chain.replace(HREF_IN_CHAIN, (_match, head: string, href: string) => {
    return `${head}${scrubValue(href)}`;
  });
}

function scrubElements(elements: unknown[]): unknown[] {
  return elements.map((element) => {
    if (!isBag(element)) return element;
    const out: Bag = { ...element };
    if ("attr__href" in out) out.attr__href = scrubValue(out.attr__href);
    if ("href" in out) out.href = scrubValue(out.href);
    return out;
  });
}

function scrubProperties(properties: Bag): Bag {
  const out = scrubUrlKeys(properties);
  if (isBag(out.$set)) out.$set = scrubUrlKeys(out.$set);
  if (isBag(out.$set_once)) out.$set_once = scrubUrlKeys(out.$set_once);
  if (typeof out.$elements_chain === "string") {
    out.$elements_chain = scrubElementsChain(out.$elements_chain);
  }
  if (Array.isArray(out.$elements)) out.$elements = scrubElements(out.$elements);
  return out;
}

/**
 * PostHog `before_send` hook: sanitizes the URL-bearing properties of EVERY
 * event (pageview, pageleave, autocapture, custom) just before it is sent.
 * Fails closed: an event this cannot read is dropped (null), never sent raw.
 */
export const sanitizePosthogEvent: BeforeSendFn = (cr) => {
  if (!cr) return null;
  try {
    const next: CaptureResult = { ...cr, properties: scrubProperties(cr.properties) };
    if (cr.$set) next.$set = scrubUrlKeys(cr.$set);
    if (cr.$set_once) next.$set_once = scrubUrlKeys(cr.$set_once);
    return next;
  } catch {
    return null;
  }
};

// Optional: like Sentry, local dev and any deployment without a configured
// PostHog project must keep working with this unset. Do not use requireEnv
// here. The project key is write-only and safe to ship in the client bundle
// (VITE_ prefix, public by design).
const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://us.i.posthog.com";

// Guard against re-initializing on every module re-evaluation (e.g. HMR) and
// against running on the server, where __root.tsx is also imported for SSR.
export const posthogEnabled = Boolean(key) && typeof window !== "undefined";

if (posthogEnabled && key) {
  posthog.init(key, {
    api_host: host,
    // Pageviews are captured explicitly from the root route so SPA navigation
    // and the initial load are measured identically.
    capture_pageview: false,
    capture_pageleave: true,
    // Members are identified in AuthProvider; visitors stay anonymous until
    // they sign in.
    person_profiles: "identified_only",
    // Sign-in, confirmation and reset pages carry tokens in the URL. This hook
    // runs on every event just before it is sent and scrubs the URL properties.
    // src: posthog-js@1.435.8 → @posthog/types@1.413.0 dist/posthog-config.d.ts
    //   `before_send?: BeforeSendFn | BeforeSendFn[]` and dist/capture.d.ts
    //   `BeforeSendFn = (cr: CaptureResult | null) => CaptureResult | null` · 2026-10-07
    before_send: sanitizePosthogEvent,
    // Privacy: Mila uses no feature flags, and the /flags request carries the
    // stored person property `$initial_current_url` (the raw landing URL, with
    // `?code=` / `?token_hash=`) without ever passing through before_send.
    // No request, no leak.
    // src: @posthog/types@1.413.0 dist/posthog-config.d.ts `advanced_disable_flags?: boolean` (posthog-js@1.435.8) · 2026-10-07
    advanced_disable_flags: true,
    // Session replay, heatmaps and dead clicks are OFF: their payloads (replay
    // meta hrefs, network entries, heatmap URL keys) are not scrubbed by the
    // before_send hook and carry raw query strings. Owner decision: PostHog
    // replay stays off for privacy; Sentry's masked on-error replay covers
    // "see what went wrong". Re-enable only with network and href masking.
    // src: @posthog/types@1.413.0 dist/posthog-config.d.ts `disable_session_recording: boolean`,
    //   `capture_heatmaps?: boolean | HeatmapConfig`, `capture_dead_clicks?: boolean | DeadClicksAutoCaptureConfig` · 2026-10-07
    disable_session_recording: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    // Defence in depth: events drop `#...` from the URLs the SDK captures.
    // src: @posthog/types@1.413.0 dist/posthog-config.d.ts `disable_capture_url_hashes` · 2026-10-07
    disable_capture_url_hashes: true,
    loaded: (ph) => {
      if (import.meta.env.DEV) ph.debug();
    },
  });
  // Super properties: every event (pageviews, mirrors, autocapture) is
  // attributable to this app and build environment.
  posthog.register({ app: "mila-web", environment: import.meta.env.MODE });
}

/** Captures a product event. No-op when PostHog is unconfigured or on the server. */
export function capturePhEvent(event: string, properties?: Record<string, unknown>): void {
  if (!posthogEnabled) return;
  posthog.capture(event, properties ?? {});
}

/** Associates the browser session with a signed-in member. No-op when PostHog is unconfigured or on the server. */
export function identifyPhUser(userId: string): void {
  if (!posthogEnabled) return;
  posthog.identify(userId);
}

/** Clears the identified person on sign-out so the next visitor starts anonymous. Events captured before the reset keep their original distinct id. */
export function resetPh(): void {
  if (!posthogEnabled) return;
  posthog.reset();
}

/**
 * Captures an SPA pageview for the given absolute URL. The URL is sanitized
 * here (see sanitizeUrl) so no caller can send a token-bearing URL. No-op when
 * PostHog is unconfigured or on the server.
 */
export function capturePageview(url: string): void {
  if (!posthogEnabled) return;
  posthog.capture("$pageview", { $current_url: sanitizeUrl(url) });
}
