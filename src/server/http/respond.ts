import { ZodError } from "zod";
import { InsufficientCreditsError } from "@/lib/credits";
import { RateLimitExceededError } from "@/lib/rate-limit.server";
import { UnauthorizedError, SuspendedError } from "@/integrations/supabase/auth-middleware";
import {
  AiUnavailableError,
  DomainValidationError,
  ForbiddenServiceError,
  UpstreamUnavailableError,
} from "./api-errors";

/**
 * The error taxonomy `MILA_MOBILE/src/services/api/errors.ts` switches on.
 * Every `/api/v1/*` route must respond with exactly one of these codes on
 * failure — anything else is invisible to the mobile client's error handling
 * and falls into its generic "fatal" bucket.
 */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "ACCOUNT_SUSPENDED"
  | "FORBIDDEN"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  ACCOUNT_SUSPENDED: 403,
  FORBIDDEN: 403,
  INSUFFICIENT_CREDITS: 402,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  INTERNAL: 500,
};

const GENERIC_INTERNAL_MESSAGE = "Something went wrong on our side. Please try again.";

export function apiError(code: ApiErrorCode, message: string, retryAfter?: number): Response {
  return Response.json(
    { error: { code, message, ...(retryAfter != null ? { retryAfter } : {}) } },
    { status: STATUS_BY_CODE[code] },
  );
}

/**
 * Classifies whatever the service layer threw and returns the matching
 * `/api/v1/*` error response. `routeName` is only used for server-side
 * logging (e.g. `"look/generate"`) — it never reaches the client.
 *
 * Unclassified errors are logged in full server-side and answered with a
 * generic `INTERNAL` message, so a raw database or provider error never
 * leaks to a member's device.
 */
export function respondWithError(routeName: string, error: unknown): Response {
  if (error instanceof UnauthorizedError) return apiError("UNAUTHENTICATED", error.message);
  if (error instanceof SuspendedError) return apiError("ACCOUNT_SUSPENDED", error.message);
  if (error instanceof ForbiddenServiceError) return apiError("FORBIDDEN", error.message);

  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? "That request wasn't valid. Please try again.";
    return apiError("VALIDATION_FAILED", message);
  }
  if (error instanceof DomainValidationError) return apiError("VALIDATION_FAILED", error.message);

  if (error instanceof InsufficientCreditsError) {
    return apiError("INSUFFICIENT_CREDITS", error.message);
  }

  if (error instanceof RateLimitExceededError) {
    return apiError("RATE_LIMITED", error.message, error.retryAfterSeconds);
  }

  if (error instanceof AiUnavailableError) return apiError("AI_UNAVAILABLE", error.message);
  if (error instanceof UpstreamUnavailableError) return apiError("AI_UNAVAILABLE", error.message);

  console.error(`[api/v1/${routeName}] unhandled error`, error);
  return apiError("INTERNAL", GENERIC_INTERNAL_MESSAGE);
}

/**
 * Parses the request body as JSON, translating a malformed body into the
 * same `VALIDATION_FAILED` response every other bad-input case produces
 * rather than letting it fall through to `INTERNAL`.
 */
export async function parseJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainValidationError("Request body must be valid JSON.");
  }
}

/**
 * Best-effort caller IP for unauthenticated, rate-limited routes (only
 * `support/message` today). File-route handlers get a plain `Request`, not
 * the H3 event `getRequestIP()` reads from — the platform still sets these
 * proxy headers, so this is the direct equivalent.
 *
 * `x-forwarded-for` is a comma-separated hop chain (`client, proxy1, proxy2`)
 * where each proxy appends the address it observed. The leftmost entry is
 * whatever the original caller sent — trivially spoofable, since a client can
 * set `X-Forwarded-For` to anything before the request ever reaches our one
 * trusted proxy (Vercel's edge). The rightmost entry is the one *our* trusted
 * proxy appended, so that's the only hop safe to rate-limit on.
 */
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const last = hops[hops.length - 1];
    return last?.trim() || null;
  }
  return request.headers.get("x-real-ip");
}
