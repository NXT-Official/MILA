import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { requireEnv } from "@/lib/env";

function createSupabaseClient() {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = requireEnv({
    SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY:
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY,
  });

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
