import { describe, expect, mock, test } from "bun:test";
import { handleSupportMessage, type HandleSupportMessageDeps } from "./message";
import { RateLimitExceededError } from "@/lib/rate-limit.server";

const VALID_INPUT = { kind: "help", message: "How do I cancel?", captchaToken: "token-123" };

function fakeDeps(overrides: Partial<HandleSupportMessageDeps> = {}): HandleSupportMessageDeps {
  return {
    submitSupportMessageForIp: mock(async () => ({ ok: true as const })),
    ...overrides,
  } as HandleSupportMessageDeps;
}

function postRequest(body: unknown) {
  return new Request("https://mila.test/api/v1/support/message", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.4" },
    body: JSON.stringify(body),
  });
}

/**
 * This route is deliberately unauthenticated (§6/§5 of the mobile contract —
 * hCaptcha + IP rate limiting are the whole defence), so there is no
 * no-token/401 case to cover here. The rate-limit path stands in as this
 * route's most relevant failure mode instead.
 */
describe("POST /api/v1/support/message", () => {
  test("happy path -> 200 ok", async () => {
    const deps = fakeDeps();
    const res = await handleSupportMessage(postRequest(VALID_INPUT), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(deps.submitSupportMessageForIp).toHaveBeenCalledWith("203.0.113.4", VALID_INPUT);
  });

  test("rate limited -> 429 RATE_LIMITED with retryAfter", async () => {
    const deps = fakeDeps({
      submitSupportMessageForIp: mock(async () => {
        throw new RateLimitExceededError(900);
      }),
    });

    const res = await handleSupportMessage(postRequest(VALID_INPUT), deps);
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(json.error.retryAfter).toBe(900);
  });

  test("missing captcha token -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleSupportMessage(
      postRequest({ kind: "help", message: "hi", captchaToken: "" }),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.submitSupportMessageForIp).not.toHaveBeenCalled();
  });
});
