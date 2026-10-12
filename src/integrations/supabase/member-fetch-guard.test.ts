import { describe, expect, test } from "bun:test";
import { AuthRetryableFetchError, createClient } from "@supabase/supabase-js";
import { fetchAccountExport, type ExportClient } from "@/lib/account-export";
import { isMemberSessionUnavailable, SESSION_UNAVAILABLE_CODE } from "@/lib/auth-session";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createMemberFetchGuard,
  PUBLIC_READ_TABLES,
  storedSessionPresent,
} from "./member-fetch-guard";

/**
 * A real supabase-js 2.110.0 client over a scripted network. Her session is
 * stored but its access token has expired and the refresh is failing, so
 * `getSession()` has no session and supabase-js sends database requests with
 * the publishable key (SupabaseClient.ts:570-578 + lib/fetch.ts:42-52). The
 * scripted PostgREST applies RLS: an anonymous read sees no rows, an anonymous
 * update or delete matches 0 rows and still answers 204, exactly the "synced" /
 * "Look deleted" that never happened.
 */
const SUPABASE_URL = "https://guardtest.supabase.co";
const KEY = "sb_publishable_guardtest";
// supabase-js default: `sb-<first host label>-auth-token` (SupabaseClient.ts:324).
const STORAGE_KEY = "sb-guardtest-auth-token";
const USER = "11111111-1111-4111-8111-111111111111";
const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "..", "supabase", "migrations");

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function jwt(expiresInSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER, exp: now + expiresInSeconds, role: "authenticated" })}.sig`;
}

function expiredSession() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: jwt(-60),
    refresh_token: "rt-1",
    expires_in: 3600,
    expires_at: now - 60,
    token_type: "bearer",
    user: { id: USER, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
  };
}

function memoryStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

type Sent = { method: string; path: string; authorization: string | null };

function scriptedNetwork() {
  const sent: Sent[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    sent.push({ method, path: url.pathname, authorization: headers.get("authorization") });
    if (url.pathname.startsWith("/auth/v1/token")) {
      return new Response(JSON.stringify({ message: "upstream down" }), { status: 503 });
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      // RLS: the publishable key is anonymous and sees, changes, nothing...
      // except the public plans, which anon may read.
      if (method === "GET" && url.pathname === "/rest/v1/subscription_plans") {
        return Response.json([{ id: "plan-1", title: "Atelier" }]);
      }
      if (method === "GET") return Response.json([]);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith("/functions/v1/") || url.pathname.startsWith("/storage/v1/")) {
      return Response.json({ ok: true, signedURL: "/object/sign/x?token=t" });
    }
    return new Response("not found", { status: 404 });
  };
  return { sent, fetchImpl };
}

/**
 * `keys.client` is the key supabase-js is created with (it sends it as the
 * `apikey` header and, with no session, as the bearer); `keys.guard` is the env
 * string the guard is configured with. They differ only in the F-3 tests.
 */
function memberClient(guarded: boolean, keys: { client?: string; guard?: string } = {}) {
  const clientKey = keys.client ?? KEY;
  const guardKey = keys.guard ?? clientKey;
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(expiredSession()) });
  const network = scriptedNetwork();
  const fetchImpl = guarded
    ? createMemberFetchGuard({
        supabaseUrl: SUPABASE_URL,
        publishableKey: guardKey,
        hasStoredSession: () => storedSessionPresent(storage, STORAGE_KEY),
        fetch: network.fetchImpl,
      })
    : network.fetchImpl;
  const client = createClient(SUPABASE_URL, clientKey, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      skipAutoInitialize: true,
    },
    global: { fetch: fetchImpl as typeof fetch },
  });
  // The refresh has already failed: auth-js serves the cached failure for 60 s
  // (GoTrueClient.ts:4855-4861) instead of its ~25 s backoff, so getSession()
  // answers at once with no session.
  (client.auth as unknown as { lastRefreshFailure: unknown }).lastRefreshFailure = {
    refreshToken: "rt-1",
    result: { data: null, error: new AuthRetryableFetchError("Failed to fetch", 0) },
    expiresAt: Date.now() + 60_000,
  };
  return { client, network };
}

// Anything that reached the network without her JWT (ours start with the
// base64url of `{"alg"`: "eyJ"), whatever key or whitespace it carried.
const anonymousDatabaseRequests = (sent: Sent[]) =>
  sent.filter(
    (r) =>
      (r.path.startsWith("/rest/v1/") ||
        r.path.startsWith("/storage/v1/") ||
        r.path.startsWith("/functions/v1/")) &&
      !/^Bearer\s+eyJ/.test(r.authorization ?? ""),
  );

describe("one guard in the Supabase client's fetch: no anonymous database request while she is signed in", () => {
  test("style profile: a blank anonymous load is refused, not served as an empty profile", async () => {
    const { client, network } = memberClient(true);
    const { data, error } = await client.from("profiles").select("*").eq("id", USER).single();
    expect(data).toBeNull();
    expect(isMemberSessionUnavailable(error)).toBe(true);
    expect(anonymousDatabaseRequests(network.sent)).toEqual([]);
  });

  test("style profile: the defaults she taps can never be written over her colour analysis as anonymous", async () => {
    const { client, network } = memberClient(true);
    const { error } = await client
      .from("profiles")
      .update({ body_type: "Pear", color_profile: { season: "Spring" } } as never)
      .eq("id", USER);
    // Without the guard this is { error: null } over 0 rows: "synced".
    expect(error).not.toBeNull();
    expect(isMemberSessionUnavailable(error)).toBe(true);
    expect(anonymousDatabaseRequests(network.sent)).toEqual([]);
  });

  test("history: deleting a look as anonymous is an error, never a 'Look deleted' toast", async () => {
    const { client, network } = memberClient(true);
    const { error } = await client.from("outfits").delete().eq("id", "look-1").eq("user_id", USER);
    expect(isMemberSessionUnavailable(error)).toBe(true);
    expect(anonymousDatabaseRequests(network.sent)).toEqual([]);
  });

  test("account export: anonymous reads fail the export instead of handing over an empty file", async () => {
    const { client, network } = memberClient(true);
    const result = await fetchAccountExport(
      { id: USER, email: "member@example.com" },
      client as unknown as ExportClient,
    );
    expect(result.ok).toBe(false);
    expect(anonymousDatabaseRequests(network.sent)).toEqual([]);
  });

  test("control: the same client WITHOUT the guard reproduces the data loss", async () => {
    const { client, network } = memberClient(false);
    const update = await client
      .from("profiles")
      .update({ body_type: "Pear" } as never)
      .eq("id", USER);
    expect(update.error).toBeNull(); // the false "synced"
    const result = await fetchAccountExport(
      { id: USER, email: "member@example.com" },
      client as unknown as ExportClient,
    );
    expect(result.ok).toBe(true); // the empty export that looks complete
    expect(anonymousDatabaseRequests(network.sent).length).toBeGreaterThan(0);
  });
});

describe("createMemberFetchGuard passes everything else unchanged", () => {
  const base = scriptedNetwork();
  const guard = (stored: boolean) =>
    createMemberFetchGuard({
      supabaseUrl: SUPABASE_URL,
      publishableKey: KEY,
      hasStoredSession: () => stored,
      fetch: base.fetchImpl,
    });

  test("a signed-out visitor's anonymous read goes through", async () => {
    const res = await guard(false)(`${SUPABASE_URL}/rest/v1/subscription_plans`, {
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
    });
    expect(res.status).toBe(200);
  });

  test("auth endpoints go through even while a session is stored", async () => {
    const res = await guard(true)(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
    });
    expect(res.status).toBe(503);
  });

  test("a request carrying her own token goes through", async () => {
    const res = await guard(true)(`${SUPABASE_URL}/rest/v1/profiles`, {
      headers: { Authorization: `Bearer ${jwt(3600)}`, apikey: KEY },
    });
    expect(res.status).toBe(200);
  });

  test("other hosts are never touched", async () => {
    const res = await guard(true)("https://elsewhere.example/rest/v1/x", {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    // Reached the network (the scripted one answers 200), not refused (401).
    expect(res.status).toBe(200);
  });

  test("storage requests are guarded too", async () => {
    const res = await guard(true)(`${SUPABASE_URL}/storage/v1/object/sign/generations/u/x.jpg`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; statusCode: string; message: string };
    expect(body.code).toBe(SESSION_UNAVAILABLE_CODE);
    expect(body.message).not.toMatch(/[–—]/);
  });
});

describe("storedSessionPresent", () => {
  test("a stored session with a refresh token counts; anything else does not", () => {
    const ok = memoryStorage({ [STORAGE_KEY]: JSON.stringify(expiredSession()) });
    expect(storedSessionPresent(ok, STORAGE_KEY)).toBe(true);
    expect(storedSessionPresent(memoryStorage({}), STORAGE_KEY)).toBe(false);
    expect(storedSessionPresent(memoryStorage({ [STORAGE_KEY]: "garbage" }), STORAGE_KEY)).toBe(
      false,
    );
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(storedSessionPresent(throwing, STORAGE_KEY)).toBe(false);
  });
});

describe("the guard reads the same storage key auth-js writes", () => {
  test("defaultAuthStorageKey matches a real 2.110.0 client's key", async () => {
    const { defaultAuthStorageKey } = await import("./client");
    const url = "https://abcdefghijklmnop.supabase.co";
    const real = createClient(url, KEY, {
      auth: { persistSession: false, autoRefreshToken: false, skipAutoInitialize: true },
    });
    expect(defaultAuthStorageKey(url)).toBe(
      (real.auth as unknown as { storageKey: string }).storageKey,
    );
  });
});

describe("round 4: public plans, functions, normalised keys, storage errors", () => {
  test("F-1: the public plans (anon may read them, migration 20260923122500) load while her refresh fails", async () => {
    const { client } = memberClient(true);
    const { data, error } = await client
      .from("subscription_plans")
      .select("id,title")
      .eq("is_active", true);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: "plan-1", title: "Atelier" }]);
  });

  test("F-1: writes to a public table stay guarded", async () => {
    const { client, network } = memberClient(true);
    const { error } = await client
      .from("subscription_plans")
      .update({ title: "x" } as never)
      .eq("id", "plan-1");
    expect(isMemberSessionUnavailable(error)).toBe(true);
    expect(anonymousDatabaseRequests(network.sent)).toEqual([]);
  });

  test("F-1: only the listed public tables pass; her own tables stay refused", async () => {
    const { client } = memberClient(true);
    const { error } = await client.from("profiles").select("*").eq("id", USER);
    expect(isMemberSessionUnavailable(error)).toBe(true);
  });

  test("F-1: a public read that embeds another table is refused (as anon the embed would come back empty)", async () => {
    const { client, network } = memberClient(true);
    const { error } = await client
      .from("subscription_plans")
      .select("id, subscriptions(status)")
      .eq("is_active", true);
    expect(isMemberSessionUnavailable(error)).toBe(true);
    expect(network.sent.filter((r) => r.path.startsWith("/rest/v1/"))).toEqual([]);
  });

  test("F-1: every allow-listed table really is anon-readable, with a member's rows, in supabase/migrations", () => {
    const sql = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
      .join("\n");
    expect(PUBLIC_READ_TABLES.length).toBeGreaterThan(0);
    for (const table of PUBLIC_READ_TABLES) {
      const t = table.replace(/[^a-z0-9_]/gi, "");
      // Granted to anon, and not revoked again afterwards (the base schema
      // revokes everything from anon first).
      const grant = lastMatchIndex(
        sql,
        new RegExp(String.raw`GRANT\s+SELECT\s+ON\s+public\.${t}\s+TO\s+anon\b`, "gi"),
      );
      const revoke = lastMatchIndex(
        sql,
        new RegExp(
          String.raw`REVOKE[^;]*\bON\s+(?:ALL\s+TABLES\s+IN\s+SCHEMA\s+public|public\.${t})\b[^;]*\bFROM\b[^;]*\banon\b`,
          "gi",
        ),
      );
      expect(grant).toBeGreaterThan(revoke);
      // An anon SELECT policy that gives exactly a member's rows: every
      // authenticated SELECT policy uses the same predicate, or is staff-only.
      const policies = [
        ...sql.matchAll(
          new RegExp(
            String.raw`CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+public\.${t}\s+FOR\s+SELECT\s+TO\s+(anon|authenticated)\s+USING\s+\(([\s\S]*?)\);`,
            "gi",
          ),
        ),
      ].map(([, name, role, using]) => ({
        name,
        role: role.toLowerCase(),
        using: using.replace(/\s+/g, " ").trim(),
      }));
      const anon = policies.filter((p) => p.role === "anon");
      expect(anon.length).toBeGreaterThan(0);
      for (const policy of anon) {
        expect(sql).not.toMatch(new RegExp(String.raw`DROP\s+POLICY[^;]*"${policy.name}"`, "i"));
      }
      for (const member of policies.filter((p) => p.role === "authenticated")) {
        const sameRows = anon.some((p) => p.using === member.using);
        expect(sameRows || member.using.includes("has_role(")).toBe(true);
      }
    }
  });

  test("F-2: an edge function call never goes out anonymous either", async () => {
    const { client, network } = memberClient(true);
    const { error } = await client.functions.invoke("any-function", { body: { a: 1 } });
    expect(error).not.toBeNull();
    expect(anonymousDatabaseRequests(network.sent)).toEqual([]);
  });

  for (const [label, envKey] of [
    ["a trailing newline", `${KEY}\n`],
    ["a trailing space", `${KEY} `],
    ["a leading space", ` ${KEY}`],
    ["surrounding tabs", `\t${KEY}\t`],
  ] as const) {
    test(`F-3: a publishable key with ${label} in env does not switch the guard off`, async () => {
      const { client, network } = memberClient(true, { client: envKey });
      const { error } = await client
        .from("profiles")
        .update({ body_type: "Pear" } as never)
        .eq("id", USER);
      expect(isMemberSessionUnavailable(error)).toBe(true);
      expect(anonymousDatabaseRequests(network.sent)).toEqual([]);
    });
  }

  test("F-3: 'anonymous' is read from the request's own apikey and Authorization, not the env string", async () => {
    // An env string that matches nothing the client sends cannot turn it off.
    const { client, network } = memberClient(true, { guard: "sb_publishable_some_other_value" });
    const { error } = await client
      .from("profiles")
      .update({ body_type: "Pear" } as never)
      .eq("id", USER);
    expect(isMemberSessionUnavailable(error)).toBe(true);
    expect(anonymousDatabaseRequests(network.sent)).toEqual([]);
  });

  test("F-3: her own token still passes when the env key carries whitespace", async () => {
    const network = scriptedNetwork();
    const guard = createMemberFetchGuard({
      supabaseUrl: SUPABASE_URL,
      publishableKey: ` ${KEY}\n`,
      hasStoredSession: () => true,
      fetch: network.fetchImpl,
    });
    const res = await guard(`${SUPABASE_URL}/rest/v1/profiles`, {
      headers: { Authorization: `Bearer ${jwt(3600)}`, apikey: KEY },
    });
    expect(res.status).toBe(200);
  });

  test("F-3: a request with no credentials at all is anonymous too", async () => {
    const network = scriptedNetwork();
    const guard = createMemberFetchGuard({
      supabaseUrl: SUPABASE_URL,
      publishableKey: KEY,
      hasStoredSession: () => true,
      fetch: network.fetchImpl,
    });
    const res = await guard(`${SUPABASE_URL}/rest/v1/profiles?select=*`);
    expect(res.status).toBe(401);
    expect(network.sent).toEqual([]);
  });

  test("F-4: a refused storage request is recognised as 'session unavailable'", async () => {
    const { client, network } = memberClient(true);
    const { error } = await client.storage.from("generations").createSignedUrl("u/x.jpg", 60);
    expect(isMemberSessionUnavailable(error)).toBe(true);
    expect(anonymousDatabaseRequests(network.sent)).toEqual([]);
  });
});

describe("re-review 3 nits: a public read is only the plain public table", () => {
  const anonymousHeaders = { Authorization: `Bearer ${KEY}`, apikey: KEY };
  const guarded = () => {
    const network = scriptedNetwork();
    const guard = createMemberFetchGuard({
      supabaseUrl: SUPABASE_URL,
      publishableKey: KEY,
      hasStoredSession: () => true,
      fetch: network.fetchImpl,
    });
    return { network, guard };
  };

  test("every `select` is read: a second one that embeds another table is refused", async () => {
    const { network, guard } = guarded();
    const res = await guard(
      `${SUPABASE_URL}/rest/v1/subscription_plans?select=*&select=${encodeURIComponent("*,profiles(*)")}`,
      { headers: anonymousHeaders },
    );
    expect(res.status).toBe(401);
    expect(network.sent).toEqual([]);
  });

  test("control: repeated plain selects with no embed still pass", async () => {
    const { network, guard } = guarded();
    const res = await guard(`${SUPABASE_URL}/rest/v1/subscription_plans?select=id&select=title`, {
      headers: anonymousHeaders,
    });
    expect(res.status).toBe(200);
    expect(network.sent).toHaveLength(1);
  });

  for (const header of ["Accept-Profile", "Content-Profile"]) {
    test(`an anonymous read naming another schema in ${header} is refused`, async () => {
      const { network, guard } = guarded();
      const res = await guard(`${SUPABASE_URL}/rest/v1/subscription_plans?select=*`, {
        headers: { ...anonymousHeaders, [header]: "private" },
      });
      expect(res.status).toBe(401);
      expect(network.sent).toEqual([]);
    });

    test(`control: ${header}: public still passes`, async () => {
      const { network, guard } = guarded();
      const res = await guard(`${SUPABASE_URL}/rest/v1/subscription_plans?select=*`, {
        headers: { ...anonymousHeaders, [header]: " public " },
      });
      expect(res.status).toBe(200);
      expect(network.sent).toHaveLength(1);
    });
  }

  test("a real 2.110.0 client reading subscription_plans from another schema is refused", async () => {
    const { client, network } = memberClient(true);
    const { error } = await client
      .schema("private" as never)
      .from("subscription_plans" as never)
      .select("*");
    expect(isMemberSessionUnavailable(error)).toBe(true);
    expect(network.sent.filter((r) => r.path.startsWith("/rest/v1/"))).toEqual([]);
  });
});

function lastMatchIndex(text: string, pattern: RegExp): number {
  let last = -1;
  for (const match of text.matchAll(pattern)) last = match.index ?? last;
  return last;
}
