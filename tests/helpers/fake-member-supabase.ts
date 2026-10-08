import type { AuthError, Session } from "@supabase/supabase-js";

/**
 * Test double for the browser Supabase client, faithful where it matters here:
 * a read without an explicit `Authorization` header goes out with the member's
 * token when `getSession()` has one, and with the publishable key (anonymous)
 * when it does not, exactly like supabase-js 2.110.0 `fetchWithAuth` +
 * `_getAccessToken`. RLS then shows an anonymous caller no rows.
 */
export type SessionRead = { data: { session: Session | null }; error: AuthError | null };

export interface FakeRequest {
  table: string;
  authorization: string;
}

type Rows = Record<string, unknown[]>;

export function fakeMemberSession(userId: string, accessToken: string): Session {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${userId}`,
    expires_in: 3600,
    expires_at: 1_900_000_000,
    token_type: "bearer",
    user: {
      id: userId,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    },
  } as Session;
}

export function fakeSupabase(initial: { session: SessionRead; rows: Rows; memberToken: string }) {
  const state = { ...initial };
  const requests: FakeRequest[] = [];

  function builder(table: string) {
    let authorization: string | null = null;
    let single = false;
    let head = false;
    const chain = {
      select: (_columns?: string, options?: { head?: boolean }) => {
        head = !!options?.head;
        return chain;
      },
      eq: () => chain,
      in: () => chain,
      gte: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => {
        single = true;
        return chain;
      },
      setHeader: (name: string, value: string) => {
        if (name.toLowerCase() === "authorization") authorization = value;
        return chain;
      },
      then: <T>(resolve: (value: unknown) => T, reject?: (reason: unknown) => T) => {
        const sent = authorization ?? sentWithoutHeader();
        requests.push({ table, authorization: sent });
        const asMember = sent === `Bearer ${state.memberToken}`;
        const rows = asMember ? (state.rows[table] ?? []) : [];
        const result = head
          ? { data: null, count: rows.length, error: null }
          : { data: single ? (rows[0] ?? null) : rows, error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return chain;
  }

  // supabase-js: `data.session?.access_token ?? this.supabaseKey`.
  function sentWithoutHeader(): string {
    const session = state.session.data.session;
    return session ? `Bearer ${session.access_token}` : "Bearer publishable-key";
  }

  const client = {
    auth: { getSession: async () => state.session },
    from: (table: string) => builder(table),
  };

  return {
    client,
    requests,
    setSession: (session: SessionRead) => {
      state.session = session;
    },
    setRows: (rows: Rows) => {
      state.rows = rows;
    },
  };
}
