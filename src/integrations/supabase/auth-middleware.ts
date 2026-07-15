import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { requireEnv } from "@/lib/env";
import { consumeRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit.server";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = requireEnv({
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    });

    const request = getRequest();

    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const authHeader = request.headers.get("authorization");

    if (!authHeader) {
      throw new Error("Unauthorized: No authorization header provided");
    }

    if (!authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Only Bearer tokens are supported");
    }

    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      throw new Error("Unauthorized: No token provided");
    }

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) {
      throw new Error("Unauthorized: Invalid token");
    }

    if (!data.claims.sub) {
      throw new Error("Unauthorized: No user ID found in token");
    }

    const isWrite = request.method.toUpperCase() !== "GET";
    await consumeRateLimit(
      `user:${isWrite ? "write" : "read"}`,
      data.claims.sub,
      isWrite ? RATE_LIMIT_POLICIES.writeFunction : RATE_LIMIT_POLICIES.generalFunction,
    );

    const { data: profile } = await supabase
      .from("profiles")
      .select("suspended")
      .eq("id", data.claims.sub)
      .maybeSingle();
    if (profile?.suspended) {
      throw new Error("Forbidden: Account suspended");
    }

    return next({
      context: {
        supabase,
        userId: data.claims.sub,
        claims: data.claims,
      },
    });
  },
);
