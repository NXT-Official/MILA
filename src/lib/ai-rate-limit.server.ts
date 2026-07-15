export { RateLimitExceededError } from "./rate-limit.server";

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const { consumeRateLimit: consume } = await import("./rate-limit.server");
  await consume(key, "user", { limit, windowSeconds, failure: "closed" });
}
