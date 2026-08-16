/**
 * The `/api/v1` wire contract.
 *
 * The shape is dictated by the client that already exists — `MILA_MOBILE`'s
 * `services/api/client.ts` — not invented here. Two rules come from it:
 *
 * 1. **Success is the bare payload**, not `{ data: ... }`. The mobile client
 *    does `return res.json() as Promise<T>` and hands the result straight to a
 *    typed caller. Wrapping it would break every `services/api/*.ts` type.
 * 2. **Failure is `{ error: { code, message, retryAfter? } }`** with a non-2xx
 *    status. The client reads exactly those three fields.
 *
 * `code` is the contract; `message` is what a member reads. The mobile side
 * maps each code to a behaviour (`paywall`, `rate-limited`, `suspended`, …), so
 * inventing a code silently degrades to a generic error screen rather than the
 * right one.
 */

/** The codes mobile's `NON_RETRYABLE_CODES` and `resolveApiFailure()` know. */
export type ApiErrorCode =
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMITED"
  | "UNAUTHENTICATED"
  | "ACCOUNT_SUSPENDED"
  | "VALIDATION_FAILED"
  | "UPSTREAM_UNAVAILABLE"
  | "INTERNAL";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    /** Plain language. Never a raw provider string — a member cannot act on one. */
    message: string,
    readonly status: number,
    /** Seconds until a rate limit lifts. Only meaningful with `RATE_LIMITED`. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function ok<T>(payload: T, status = 200): Response {
  return Response.json(payload, { status });
}

export function fail(error: ApiError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
      },
    },
    { status: error.status },
  );
}

/**
 * Wraps a handler so no route has to repeat the try/catch, and — more
 * importantly — so an unexpected throw cannot leak.
 *
 * An `ApiError` is deliberate and its message is member-facing. Anything else
 * is a bug, a provider outage, or a Postgres error: it is logged server-side and
 * answered with a generic 500, because raw provider text and stack traces are
 * exactly the things that must never reach a client.
 */
export function handler(fn: (request: Request) => Promise<Response>) {
  return async ({ request }: { request: Request }): Promise<Response> => {
    try {
      return await fn(request);
    } catch (error) {
      if (error instanceof ApiError) return fail(error);

      console.error("[api/v1] unhandled", error);
      return fail(new ApiError("INTERNAL", "Something went wrong on our side.", 500));
    }
  };
}

/** Body parsing that fails as a member-readable 400 rather than a 500. */
export async function jsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError("VALIDATION_FAILED", "That request could not be read.", 400);
  }
}
