import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { requireEnv } from "@/lib/env";

/**
 * Thrown by {@link verifyBearerAuth} when the request carries no usable
 * credential (missing header, malformed scheme, empty/invalid token). Maps to
 * `401 UNAUTHENTICATED` for `/api/v1/*` callers; the TanStack Start
 * `createServerFn` callers only ever see `.message`, so the message text is
 * unchanged from what this file threw before the refactor.
 */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Thrown by {@link verifyBearerAuth} when the credential is valid but the
 * account is suspended. Maps to `403 ACCOUNT_SUSPENDED`.
 */
export class SuspendedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuspendedError";
  }
}

export type VerifiedAuth = {
  supabase: SupabaseClient<Database>;
  userId: string;
  claims: NonNullable<
    Awaited<ReturnType<SupabaseClient<Database>["auth"]["getClaims"]>>["data"]
  >["claims"];
};

/**
 * The shared bearer-token verification body. Reads `Authorization: Bearer
 * <token>` off the given `Request`, validates it against Supabase, and checks
 * the caller's `profiles.suspended` flag.
 *
 * Extracted from {@link requireSupabaseAuth} so `/api/v1/*` file-route
 * handlers — which already receive `{ request }` from TanStack Start and have
 * no `createMiddleware` context to hook into — can call it directly instead
 * of going through `getRequest()`.
 */
export async function verifyBearerAuth(request: Request): Promise<VerifiedAuth> {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = requireEnv({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  });

  if (!request?.headers) {
    throw new UnauthorizedError("Unauthorized: No request headers available");
  }

  const authHeader = request.headers.get("authorization");

  if (!authHeader) {
    throw new UnauthorizedError("Unauthorized: No authorization header provided");
  }

  if (!authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("Unauthorized: Only Bearer tokens are supported");
  }

  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    throw new UnauthorizedError("Unauthorized: No token provided");
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
    throw new UnauthorizedError("Unauthorized: Invalid token");
  }

  if (!data.claims.sub) {
    throw new UnauthorizedError("Unauthorized: No user ID found in token");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("suspended")
    .eq("id", data.claims.sub)
    .maybeSingle();
  if (profile?.suspended) {
    throw new SuspendedError("Forbidden: Account suspended");
  }

  return {
    supabase,
    userId: data.claims.sub,
    claims: data.claims,
  };
}

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    const { supabase, userId, claims } = await verifyBearerAuth(request as unknown as Request);

    return next({
      context: {
        supabase,
        userId,
        claims,
      },
    });
  },
);
