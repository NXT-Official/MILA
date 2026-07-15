import {
  clientIp,
  consumeRateLimit,
  isRateLimitExempt,
  RATE_LIMIT_POLICIES,
  RateLimitExceededError,
} from "./rate-limit.server";

type GlobalRateLimitContext<T> = {
  request: Request;
  pathname: string;
  handlerType: string;
  next: () => Promise<T> | T;
};

export type GlobalRateLimitDependencies = {
  getIp?: (request: Request) => string | undefined;
  consume?: typeof consumeRateLimit;
};

export async function handleGlobalRateLimit<T>(
  { request, pathname, handlerType, next }: GlobalRateLimitContext<T>,
  { getIp = clientIp, consume = consumeRateLimit }: GlobalRateLimitDependencies = {},
) {
  if (isRateLimitExempt(pathname)) return next();
  const ip = getIp(request);
  if (!ip) {
    console.error(JSON.stringify({ event: "rate_limit_identity_missing" }));
    return next();
  }
  const method = request.method.toUpperCase();
  const policy =
    handlerType === "serverFn"
      ? method === "GET"
        ? RATE_LIMIT_POLICIES.generalFunction
        : RATE_LIMIT_POLICIES.writeFunction
      : RATE_LIMIT_POLICIES.anonymousPage;
  try {
    await consume(`global:${handlerType}:${method}`, ip, policy);
    return next();
  } catch (error) {
    if (!(error instanceof RateLimitExceededError)) throw error;
    return new Response(
      handlerType === "serverFn"
        ? JSON.stringify({ error: "Too many requests" })
        : "Too many requests",
      {
        status: 429,
        headers: {
          "content-type":
            handlerType === "serverFn" ? "application/json" : "text/plain; charset=utf-8",
          "retry-after": String(error.retryAfterSeconds),
        },
      },
    );
  }
}
