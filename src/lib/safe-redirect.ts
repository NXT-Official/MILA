import type { AuthenticatedDestination } from "@/lib/queries/auth";

/**
 * Where the sign-in screen may send her back to: a path on this site, never
 * anywhere else. The value arrives in the URL (`/login?redirect=…`), so anyone
 * can craft it; everything that could leave the origin is refused and the
 * caller falls back to its default destination.
 *
 * Refused: absolute URLs on any scheme, protocol-relative `//host`, any
 * backslash (the WHATWG URL parser treats `\` as `/` for http(s), so `/\host`
 * becomes `//host`), ASCII control characters (the parser strips tab, CR and
 * LF, so `/\t/host` also becomes `//host`), dot segments, plain or
 * percent-encoded (the parser removes `.` and `%2e` segments, so `/.//host`
 * and `/a/..//host` become `//host`), and encoded slashes or backslashes in the
 * path. A suspicious value is refused, never "fixed": the parsed path must be
 * byte-for-byte the path that was given, and the result is re-checked.
 * // src: https://url.spec.whatwg.org/#concept-basic-url-parser (special-scheme
 * //      backslash handling; "remove all ASCII tab or newline from input";
 * //      single-dot and double-dot URL path segments, incl. `%2e`)
 */
const MAX_REDIRECT_LENGTH = 2048;
const PROBE_ORIGIN = "https://mila.invalid";
const ENCODED_SEPARATOR = /%(2f|5c)/i;
/** `%00`-`%1F` and `%7F`: never part of a page she would be sent back to. */
const ENCODED_CONTROL = /%(0[0-9a-f]|1[0-9a-f]|7f)/i;

function hasControlOrBackslash(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/** The path part of a relative URL: everything before `?` or `#`. */
function rawPathOf(value: string): string {
  const end = value.search(/[?#]/);
  return end === -1 ? value : value.slice(0, end);
}

function hasDotSegment(path: string): boolean {
  return path.split("/").some((segment) => {
    const decoded = segment.replace(/%2e/gi, ".");
    return decoded === "." || decoded === "..";
  });
}

/** Exactly one leading slash: never `//host` or `/\host`. */
function isSingleSlashPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

/** Sign-in and auth screens: sending her back to one would loop. */
function isAuthScreen(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/")
  );
}

export function safeRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return null;
  if (value.trim() !== value) return null;
  if (!isSingleSlashPath(value)) return null;
  if (hasControlOrBackslash(value)) return null;

  const rawPath = rawPathOf(value);
  if (ENCODED_CONTROL.test(value)) return null;
  if (ENCODED_SEPARATOR.test(rawPath) || hasDotSegment(rawPath)) return null;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  // The parser must not have restructured the path in any way.
  if (url.pathname !== rawPath) return null;
  if (isAuthScreen(url.pathname)) return null;

  const result = `${url.pathname}${url.search}${url.hash}`;
  return isSingleSlashPath(result) ? result : null;
}

/** The `/login` search that brings her back to `href` after sign-in. */
/**
 * The `/login` route's search validator. router-core builds a match's search
 * as `{ ...rawSearch, ...validated }` (router-core 1.171.34 src/router.ts
 * :1610-1622), so returning `{}` would leave the raw, unsafe `redirect` in
 * `useSearch()`. The key is always written: the safe path or `undefined`.
 * // src: node_modules/@tanstack/router-core/src/router.ts · 1.171.34
 */
export function validateLoginSearch(search: Record<string, unknown>): { redirect?: string } {
  return { redirect: safeRedirect(search.redirect) ?? undefined };
}

/**
 * Where Supabase sends her back after an email link (sign-up confirmation) or
 * Google sign-in: the `/auth/callback` page of the deployment she is on, with
 * her safe return path (or the dashboard). Every auth call that leaves the
 * site passes this explicitly: without it Supabase falls back to the
 * project's Site URL, the live site, even from a preview deployment. Supabase
 * only honours it when it is on the project's Redirect URLs allow-list.
 * // src: https://supabase.com/docs/guides/auth/redirect-urls
 */
export function authCallbackUrl(origin: string, returnTo: unknown): string {
  const next = safeRedirect(returnTo) ?? "/dashboard";
  return `${new URL(origin).origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export function loginRedirectSearch(href: string | undefined): { redirect?: string } {
  const target = safeRedirect(href);
  return target ? { redirect: target } : {};
}

/**
 * Where to go once she is signed in: an unfinished style profile always comes
 * first; otherwise the page she was on, or the dashboard.
 */
export function postLoginDestination(
  destination: AuthenticatedDestination,
  returnTo: unknown,
): string {
  if (destination !== "/dashboard") return destination;
  return safeRedirect(returnTo) ?? destination;
}
