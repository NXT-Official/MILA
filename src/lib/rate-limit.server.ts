import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getRequestIP } from "@tanstack/react-start/server";

export const RATE_LIMIT_POLICIES = {
  anonymousPage: { limit: 120, windowSeconds: 60, failure: "open" },
  authenticatedPage: { limit: 300, windowSeconds: 60, failure: "open" },
  generalFunction: { limit: 60, windowSeconds: 60, failure: "open" },
  writeFunction: { limit: 20, windowSeconds: 60, failure: "closed" },
  loginIp: { limit: 10, windowSeconds: 600, failure: "closed" },
  loginAccount: { limit: 5, windowSeconds: 900, failure: "closed" },
  signupIp: { limit: 5, windowSeconds: 900, failure: "closed" },
  signupAccount: { limit: 3, windowSeconds: 3600, failure: "closed" },
  oauthIp: { limit: 20, windowSeconds: 600, failure: "closed" },
  supportIp: { limit: 3, windowSeconds: 900, failure: "closed" },
} as const;

export class RateLimitExceededError extends Error {
  readonly statusCode = 429;
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests. Please try again later.");
    this.name = "RateLimitExceededError";
  }
}

export type RateLimitPolicy = {
  limit: number;
  windowSeconds: number;
  failure: "open" | "closed";
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  reset_at: string | Date;
  retry_after_seconds: number;
};

export type RateLimitStore = (
  key: string,
  policy: RateLimitPolicy,
  cost: number,
) => Promise<RateLimitResult>;

export type RateLimitLogger = Pick<Console, "error" | "warn">;

export function normalizeIp(value: string | undefined): string | undefined {
  if (!value) return;
  const candidate = value
    .trim()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  if (isIP(candidate) === 4) return candidate;
  if (isIP(candidate) === 6) return candidate.toLowerCase().replace(/^::ffff:/, "");
}

export function clientIp(
  request?: Request,
  runtimeIp: () => string | undefined = getRequestIP,
): string | undefined {
  const trustedHeader = process.env.RATE_LIMIT_TRUSTED_IP_HEADER?.toLowerCase();
  const fromHeader =
    trustedHeader && request
      ? normalizeIp(request.headers.get(trustedHeader) ?? undefined)
      : undefined;
  return fromHeader ?? normalizeIp(runtimeIp());
}

export function accountKey(email: string, secret = process.env.RATE_LIMIT_HMAC_SECRET): string {
  if (!email.trim()) throw new Error("Account identifier is required");
  if (!secret) throw new Error("Missing required environment variable: RATE_LIMIT_HMAC_SECRET");
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

async function supabaseRateLimitStore(key: string, policy: RateLimitPolicy, cost: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .rpc("check_rate_limit", {
      _key: key,
      _limit: policy.limit,
      _window_seconds: policy.windowSeconds,
      _cost: cost,
    })
    .single();
  if (error) throw error;
  return data as RateLimitResult;
}

export async function consumeRateLimit(
  namespace: string,
  identity: string,
  policy: RateLimitPolicy,
  cost = 1,
  store: RateLimitStore = supabaseRateLimitStore,
  logger: RateLimitLogger = console,
) {
  if (!namespace || !identity || policy.limit <= 0 || policy.windowSeconds <= 0 || cost <= 0) {
    throw new Error("Invalid rate limit configuration");
  }
  let data: RateLimitResult;
  try {
    data = await store(`${namespace}:${identity}`, policy, cost);
  } catch {
    logger.error(JSON.stringify({ event: "rate_limit_store_error", policy: namespace }));
    if (policy.failure === "closed")
      throw new Error("Request protection is temporarily unavailable.");
    return;
  }
  if (!data?.allowed) {
    logger.warn(JSON.stringify({ event: "rate_limit_block", policy: namespace }));
    throw new RateLimitExceededError(data?.retry_after_seconds ?? policy.windowSeconds);
  }
  return data;
}

const STATIC_PATH =
  /(?:^\/(?:_build|assets)\/|\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)$)/i;
export function isRateLimitExempt(pathname: string) {
  return pathname === "/favicon.ico" || pathname === "/health" || STATIC_PATH.test(pathname);
}
