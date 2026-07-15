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

export function normalizeIp(value: string | undefined): string | undefined {
  if (!value) return;
  const candidate = value
    .trim()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  if (isIP(candidate) === 4) return candidate;
  if (isIP(candidate) === 6) return candidate.toLowerCase().replace(/^::ffff:/, "");
}

export function clientIp(request?: Request): string | undefined {
  const trustedHeader = process.env.RATE_LIMIT_TRUSTED_IP_HEADER?.toLowerCase();
  const fromHeader =
    trustedHeader && request
      ? normalizeIp(request.headers.get(trustedHeader) ?? undefined)
      : undefined;
  return fromHeader ?? normalizeIp(getRequestIP());
}

export function accountKey(email: string): string {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret) throw new Error("Missing required environment variable: RATE_LIMIT_HMAC_SECRET");
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

export async function consumeRateLimit(
  namespace: string,
  identity: string,
  policy: { limit: number; windowSeconds: number; failure: "open" | "closed" },
  cost = 1,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .rpc("check_rate_limit", {
      _key: `${namespace}:${identity}`,
      _limit: policy.limit,
      _window_seconds: policy.windowSeconds,
      _cost: cost,
    })
    .single();
  if (error) {
    console.error(JSON.stringify({ event: "rate_limit_store_error", policy: namespace }));
    if (policy.failure === "closed")
      throw new Error("Request protection is temporarily unavailable.");
    return;
  }
  if (!data?.allowed) {
    console.warn(JSON.stringify({ event: "rate_limit_block", policy: namespace }));
    throw new RateLimitExceededError(data?.retry_after_seconds ?? policy.windowSeconds);
  }
  return data;
}

const STATIC_PATH =
  /(?:^\/(?:_build|assets)\/|\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)$)/i;
export function isRateLimitExempt(pathname: string) {
  return pathname === "/favicon.ico" || pathname === "/health" || STATIC_PATH.test(pathname);
}
