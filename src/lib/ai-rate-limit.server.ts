import { consumeRateLimit as consume, RateLimitExceededError } from "./rate-limit.server";

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  await consume(key, "user", { limit, windowSeconds, failure: "closed" });
}

export { RateLimitExceededError };
