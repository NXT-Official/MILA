import assert from "node:assert/strict";
import { describe, test, beforeEach, afterEach } from "node:test";
import { verifyHcaptcha } from "./hcaptcha.server";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SECRET = process.env.HCAPTCHA_SECRET;

describe("verifyHcaptcha", () => {
  beforeEach(() => {
    process.env.HCAPTCHA_SECRET = "test-secret";
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    process.env.HCAPTCHA_SECRET = ORIGINAL_SECRET;
  });

  test("rejects a missing token without calling the network", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as typeof fetch;
    await assert.rejects(() => verifyHcaptcha(null));
    assert.equal(called, false);
  });

  test("fails closed when HCAPTCHA_SECRET is not configured", async () => {
    delete process.env.HCAPTCHA_SECRET;
    await assert.rejects(() => verifyHcaptcha("some-token"));
  });

  test("rejects when hCaptcha reports success: false", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false }), { status: 200 })) as typeof fetch;
    await assert.rejects(() => verifyHcaptcha("bad-token"));
  });

  test("fails closed on a network error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    await assert.rejects(() => verifyHcaptcha("some-token"));
  });

  test("accepts a token hCaptcha reports success: true for", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 })) as typeof fetch;
    await assert.doesNotReject(() => verifyHcaptcha("good-token"));
  });
});
