import { describe, expect, mock, test } from "bun:test";
import { RateLimitExceededError } from "./rate-limit.server";
import { handleGlobalRateLimit } from "./rate-limit-middleware-handler.server";

const context = (pathname = "/api/action", handlerType = "serverFn") => ({
  request: new Request(`https://example.test${pathname}`, { method: "POST" }),
  pathname,
  handlerType,
  next: mock(async () => new Response("ok")),
});

describe("global rate limit middleware", () => {
  test("continues allowed requests using IP identity", async () => {
    const ctx = context();
    const consume = mock(async () => undefined);
    expect((await handleGlobalRateLimit(ctx, { getIp: () => "203.0.113.5", consume })).status).toBe(
      200,
    );
    expect(ctx.next).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith("global:serverFn:POST", "203.0.113.5", expect.any(Object));
  });

  test("returns sanitized JSON 429 with Retry-After without invoking the handler", async () => {
    const ctx = context();
    const response = await handleGlobalRateLimit(ctx, {
      getIp: () => "203.0.113.5",
      consume: async () => {
        throw new RateLimitExceededError(17);
      },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(await response.json()).toEqual({ error: "Too many requests" });
    expect(ctx.next).not.toHaveBeenCalled();
  });

  test("bypasses static resources before limiter lookup", async () => {
    const ctx = context("/assets/app.js", "request");
    const consume = mock(async () => undefined);
    await handleGlobalRateLimit(ctx, { getIp: () => "203.0.113.5", consume });
    expect(ctx.next).toHaveBeenCalledTimes(1);
    expect(consume).not.toHaveBeenCalled();
  });

  test("surfaces fail-closed store failures and allows missing runtime IP safely", async () => {
    const failure = context();
    await expect(
      handleGlobalRateLimit(failure, {
        getIp: () => "ip",
        consume: async () => {
          throw new Error("store failed");
        },
      }),
    ).rejects.toThrow("store failed");
    const missing = context();
    expect((await handleGlobalRateLimit(missing, { getIp: () => undefined })).status).toBe(200);
  });
});
