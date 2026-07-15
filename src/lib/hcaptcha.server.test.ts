import { afterEach, describe, expect, mock, test } from "bun:test";
import { verifyHcaptcha } from "./hcaptcha.server";

const originalSecret = process.env.HCAPTCHA_SECRET;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.HCAPTCHA_SECRET;
  else process.env.HCAPTCHA_SECRET = originalSecret;
});

describe("hCaptcha server verification", () => {
  test("rejects missing tokens without a network request", async () => {
    process.env.HCAPTCHA_SECRET = "test-secret";
    globalThis.fetch = mock(async () => new Response()) as unknown as typeof fetch;
    await expect(verifyHcaptcha("")).rejects.toThrow("Captcha verification failed");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("posts token and remote IP and accepts only success true", async () => {
    process.env.HCAPTCHA_SECRET = "test-secret";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("secret")).toBe("test-secret");
      expect(body.get("response")).toBe("captcha-token");
      expect(body.get("remoteip")).toBe("203.0.113.9");
      return Response.json({ success: true });
    }) as unknown as typeof fetch;
    await expect(verifyHcaptcha("captcha-token", "203.0.113.9")).resolves.toBeUndefined();
  });

  test("fails safely for provider rejection, invalid JSON outcome, and missing secret", async () => {
    process.env.HCAPTCHA_SECRET = "test-secret";
    globalThis.fetch = mock(async () =>
      Response.json({ success: false }),
    ) as unknown as typeof fetch;
    await expect(verifyHcaptcha("token")).rejects.toThrow("Captcha verification failed");
    globalThis.fetch = mock(
      async () => new Response("no", { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(verifyHcaptcha("token")).rejects.toThrow("Captcha verification failed");
    delete process.env.HCAPTCHA_SECRET;
    await expect(verifyHcaptcha("token")).rejects.toThrow("not available");
  });
});
