import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { requireEnv } from "@/lib/env";
import { createMemberFetchGuard, storedSessionPresent } from "./member-fetch-guard";

/**
 * supabase-js's default storage key: `sb-<first label of the host>-auth-token`.
 * Computed the same way so the fetch guard reads the session auth-js stored.
 * // src: node_modules/@supabase/supabase-js/src/SupabaseClient.ts:324 · 2.110.0
 */
export function defaultAuthStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

function createSupabaseClient() {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = requireEnv({
    SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY:
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY,
  });

  const inBrowser = typeof window !== "undefined";
  const storageKey = defaultAuthStorageKey(SUPABASE_URL);

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: inBrowser ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
    // In the browser, while her session is stored, no database or storage
    // request may go out as anonymous (see member-fetch-guard.ts).
    ...(inBrowser
      ? {
          global: {
            fetch: createMemberFetchGuard({
              supabaseUrl: SUPABASE_URL,
              publishableKey: SUPABASE_PUBLISHABLE_KEY,
              hasStoredSession: () => {
                try {
                  return storedSessionPresent(localStorage, storageKey);
                } catch {
                  return false;
                }
              },
            }) as typeof fetch,
          },
        }
      : {}),
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
