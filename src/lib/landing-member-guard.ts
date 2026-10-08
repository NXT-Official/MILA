/**
 * Keeps a signed-in member from seeing the marketing landing flash on her way
 * into the app.
 *
 * Why it is needed: the session lives in localStorage, so the server renders
 * `/` as the public landing for everyone, and on hydration TanStack Router
 * does not re-run the route's `beforeLoad` ("Hydration trusts transported
 * context and beforeLoad", router-core 1.171.34 src/load-client.ts `hydrate`),
 * so the client-side redirect in `/`'s beforeLoad never fires on a full page
 * load. A member who opens the site, follows an email confirmation link, or
 * returns from an OAuth sign-in to the site root would see the landing paint
 * before the app takes over.
 *
 * The fix runs before first paint: an inline <head> script marks <html> when
 * this browser holds a Supabase session (or is mid sign-in), and an inline
 * style hides only the landing and shows the splash instead. The app clears
 * the mark the moment it knows she is not signed in, and a CSS fallback
 * reveals the landing after 10 s if the app never takes over.
 */

export const MEMBER_ARRIVING_ATTR = "data-member-arriving";

interface GuardWindow {
  localStorage: Pick<Storage, "length" | "key" | "getItem">;
  location: { search: string; hash: string };
  document: { documentElement: Pick<HTMLElement, "setAttribute" | "removeAttribute"> };
}

/**
 * Serialised into an inline script, so it must stay self-contained: no
 * imports, no closures, nothing but the `w` it is given.
 * Storage key format: `sb-<project ref>-auth-token` (+ `-code-verifier` while a
 * PKCE sign-in is in flight).
 * // src: node_modules/@supabase/supabase-js/src/SupabaseClient.ts `defaultStorageKey` · 2.110.0
 */
export function detectMemberArriving(w: GuardWindow): void {
  try {
    const sessionKey = /^sb-.+-auth-token$/;
    const verifierKey = /^sb-.+-auth-token-code-verifier$/;
    const ls = w.localStorage;
    let arriving = false;
    let verifier = false;
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (!key) continue;
      if (verifierKey.test(key)) verifier = true;
      if (!sessionKey.test(key)) continue;
      try {
        const value = JSON.parse(ls.getItem(key) || "null");
        if (value && typeof value.refresh_token === "string" && value.refresh_token) {
          arriving = true;
        }
      } catch {
        // Not a session; keep looking.
      }
    }
    if (!arriving && verifier && /[?&]code=/.test(w.location.search)) arriving = true;
    if (!arriving && /[#&]access_token=/.test(w.location.hash)) arriving = true;
    if (arriving) w.document.documentElement.setAttribute("data-member-arriving", "");
  } catch {
    // Storage blocked: she sees the landing, exactly as before.
  }
}

export const MEMBER_ARRIVING_SCRIPT = `(${detectMemberArriving.toString()})(window);`;

/**
 * Set on <html> by the auth provider once it knows she is signed out or
 * reconnecting. The style ignores the "arriving" mark from then on, so a head
 * script that re-runs on a client navigation to `/` (react-router re-injects
 * inline head scripts) can never hide the landing for a visitor.
 */
export const AUTH_SETTLED_ATTR = "data-auth-settled";

const ARRIVING = `html[${MEMBER_ARRIVING_ATTR}]:not([${AUTH_SETTLED_ATTR}])`;

export const MEMBER_ARRIVING_STYLE = [
  `${ARRIVING} [data-landing-root]{visibility:hidden;animation:mila-landing-reveal 0s linear 10s forwards}`,
  `${ARRIVING} [data-member-splash]{animation:mila-member-splash-hide 0s linear 10s forwards}`,
  `html:not([${MEMBER_ARRIVING_ATTR}]) [data-member-splash]{display:none}`,
  `html[${AUTH_SETTLED_ATTR}] [data-member-splash]{display:none}`,
  `@keyframes mila-landing-reveal{to{visibility:visible}}`,
  `@keyframes mila-member-splash-hide{to{visibility:hidden}}`,
].join("");

/** She is not signed in after all (or the auth server is unreachable): show the landing. */
export function clearMemberArriving(
  doc: { documentElement: Pick<HTMLElement, "removeAttribute"> } = document,
): void {
  doc.documentElement.removeAttribute(MEMBER_ARRIVING_ATTR);
}

/** Mirror the auth status onto <html> so the pre-paint style knows when to stand down. */
export function markAuthSettled(
  status: "loading" | "signed-in" | "signed-out" | "reconnecting",
  doc: { documentElement: Pick<HTMLElement, "setAttribute" | "removeAttribute"> } = document,
): void {
  if (status === "signed-out" || status === "reconnecting") {
    doc.documentElement.setAttribute(AUTH_SETTLED_ATTR, "");
  } else {
    doc.documentElement.removeAttribute(AUTH_SETTLED_ATTR);
  }
}
