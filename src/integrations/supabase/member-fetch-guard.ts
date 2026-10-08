import { SESSION_UNAVAILABLE_CODE, reportSessionUnavailable } from "@/lib/auth-session";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * One guard for every database and storage request the browser client makes.
 *
 * supabase-js sends each PostgREST and Storage request through
 * `fetchWithAuth`, which sets `Authorization: Bearer <access token>` from
 * `getSession()`, or `Bearer <publishable key>` when there is no session
 * (`_getAccessToken` returns `data.session?.access_token ?? this.supabaseKey`),
 * and then calls the custom `global.fetch` this guard is installed as.
 * When her token has expired and the refresh is failing, auth-js keeps the
 * session in storage but `getSession()` returns none, so every read and write
 * would go out as anonymous: RLS shows an empty profile, and an update or
 * delete matches 0 rows and still answers 204, which the app reports as
 * "synced" or "Look deleted".
 *
 * So, while a session is stored, any `/rest/v1/`, `/storage/v1/` or
 * `/functions/v1/` request that carries only the publishable key is refused
 * here with a typed 401 (`code: MILA_SESSION_UNAVAILABLE`). postgrest-js hands
 * a non-2xx JSON body back as `error` (PostgrestBuilder.ts:530-540), so every
 * caller sees an error instead of a fake success, and nothing is sent. Auth
 * endpoints, other hosts, a genuinely signed-out visitor, and plain reads of
 * the public tables (PUBLIC_READ_TABLES) pass unchanged.
 * // src: node_modules/@supabase/supabase-js/src/SupabaseClient.ts:359-391,570-578 ·
 * //      src/lib/fetch.ts:42-52 · 2.110.0
 * // src: node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:471-560 · 2.110.0
 */
export function createMemberFetchGuard(options: {
  supabaseUrl: string;
  publishableKey: string;
  hasStoredSession: () => boolean;
  fetch?: Fetch;
}): Fetch {
  const base: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const supabaseOrigin = new URL(options.supabaseUrl).origin;
  // Only a fallback for a request that carries no `apikey` header (supabase-js
  // always sets one). Trimmed, since header values are normalised.
  const envKey = options.publishableKey.trim();

  return (input, init) => {
    const url = requestUrl(input);
    if (url && url.origin === supabaseOrigin && isGuardedPath(url.pathname)) {
      const headers = new Headers(
        init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : {}),
      );
      const method = (
        init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
      ).toUpperCase();
      if (
        isAnonymous(headers, envKey) &&
        !isPublicRead(url, method, headers) &&
        options.hasStoredSession()
      ) {
        reportSessionUnavailable();
        return Promise.resolve(sessionUnavailableResponse());
      }
    }
    return base(input, init);
  };
}

/**
 * Whether the request would run as `anon`, read from the request's own
 * headers (F-3). `fetchWithAuth` sets `apikey: <key>` and, with no session,
 * `Authorization: Bearer <the same key>`, so "the bearer is the apikey" is the
 * anonymous request whatever the env string looks like. Comparing against the
 * raw env key failed open: `Headers` strips leading and trailing whitespace
 * from values, so a key with a stray newline in env never matched and the
 * guard silently never fired. The bearer token is trimmed too (a leading space
 * in the key survives inside "Bearer  key"). No credentials at all is
 * anonymous as well.
 * // src: node_modules/@supabase/supabase-js/src/lib/fetch.ts:42-52 · 2.110.0
 * // src: https://fetch.spec.whatwg.org/#concept-header-value-normalize
 */
function isAnonymous(headers: Headers, envKey: string): boolean {
  const authorization = headers.get("authorization");
  if (authorization === null) return true;
  const token = /^bearer\s+(.*)$/i.exec(authorization)?.[1]?.trim() ?? authorization.trim();
  const apikey = headers.get("apikey")?.trim();
  if (apikey) return token === apikey;
  return token === envKey;
}

/**
 * Tables RLS lets `anon` SELECT with exactly the rows a member sees, so an
 * anonymous GET of them is what a signed-out visitor gets anyway (F-1: the
 * plans on the landing, /membership and /pricing must load while her refresh
 * is failing). Reads only: a write to them stays guarded. A read that embeds
 * another table (`select=...,other(...)`) is refused too, since as anon the
 * embedded member rows would come back empty.
 * - subscription_plans: `GRANT SELECT ON public.subscription_plans TO anon` and
 *   policy "Public view active plans" FOR SELECT TO anon USING (is_active AND
 *   archived_at IS NULL), the same predicate as "Authenticated view active
 *   plans" (only the staff-only has_role policy sees more).
 *   // src: supabase/migrations/20260923122500_grant_public_read_active_subscription_plans.sql:9-13
 *   // src: supabase/migrations/20260706102649_create_full_schema.sql:899-905
 * No other table is anon-readable: the base schema revokes every table from
 * anon (20260706102649_create_full_schema.sql:713) and no later migration
 * grants one back. The test "every allow-listed table really is anon-readable"
 * re-checks this against supabase/migrations on every run.
 */
export const PUBLIC_READ_TABLES: readonly string[] = ["subscription_plans"];

/**
 * A plain read of a public table and nothing else: every `select` parameter
 * is checked (a repeated one could add an embed), and a schema other than
 * `public` named in `Accept-Profile` or `Content-Profile` (PostgREST's schema
 * switch, what `client.schema(...)` sends) is not the public table. The test
 * "a real 2.110.0 client reading subscription_plans from another schema is
 * refused" pins that header against the installed postgrest-js 2.110.0.
 */
function isPublicRead(url: URL, method: string, headers: Headers): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (!url.pathname.startsWith("/rest/v1/")) return false;
  const table = url.pathname.slice("/rest/v1/".length);
  if (!PUBLIC_READ_TABLES.includes(table)) return false;
  for (const header of ["accept-profile", "content-profile"]) {
    const schema = headers.get(header);
    if (schema !== null && schema.trim() !== "public") return false;
  }
  return url.searchParams.getAll("select").every((select) => !select.includes("("));
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") return new URL(input);
    if (input instanceof URL) return input;
    return new URL(input.url);
  } catch {
    return null;
  }
}

/** Database, storage and edge functions (F-2): nothing there goes out anonymous for her. */
function isGuardedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/rest/v1/") ||
    pathname.startsWith("/storage/v1/") ||
    pathname.startsWith("/functions/v1/")
  );
}

function sessionUnavailableResponse(): Response {
  const message = "You're reconnecting. Nothing was read or saved; please try again in a moment.";
  return new Response(
    JSON.stringify({
      code: SESSION_UNAVAILABLE_CODE,
      message,
      details: null,
      hint: null,
      // storage-js takes `statusCode` (then `code`) into StorageApiError
      // .statusCode, so storage refusals are recognisable too (F-4).
      // src: node_modules/@supabase/storage-js/src/lib/common/fetch.ts:76-79 · 2.110.0
      statusCode: SESSION_UNAVAILABLE_CODE,
      error: SESSION_UNAVAILABLE_CODE,
    }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

/** Whether auth-js has a session stored (even one whose access token has expired). */
export function storedSessionPresent(
  storage: { getItem(key: string): string | null },
  storageKey: string,
): boolean {
  try {
    const value = JSON.parse(storage.getItem(storageKey) || "null") as {
      refresh_token?: unknown;
    } | null;
    return !!value && typeof value.refresh_token === "string" && value.refresh_token.length > 0;
  } catch {
    return false;
  }
}
