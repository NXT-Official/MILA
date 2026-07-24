import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyPaddleSignature } from "./paddle-webhook.server";

const secret = "whsec_test_secret";

function signedHeader(body: string, ts: string, withSecret = secret): string {
  const h1 = createHmac("sha256", withSecret).update(`${ts}:${body}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

describe("verifyPaddleSignature", () => {
  test("accepts a correctly signed payload", () => {
    const body = JSON.stringify({ event_type: "subscription.created" });
    const header = signedHeader(body, "1700000000");
    expect(verifyPaddleSignature(body, header, secret)).toBe(true);
  });

  test("rejects a tampered body", () => {
    const body = JSON.stringify({ event_type: "subscription.created" });
    const header = signedHeader(body, "1700000000");
    expect(verifyPaddleSignature(body + "tampered", header, secret)).toBe(false);
  });

  test("rejects a signature made with the wrong secret", () => {
    const body = JSON.stringify({ event_type: "subscription.created" });
    const header = signedHeader(body, "1700000000", "whsec_other_secret");
    expect(verifyPaddleSignature(body, header, secret)).toBe(false);
  });

  test("rejects a missing header", () => {
    expect(verifyPaddleSignature("{}", null, secret)).toBe(false);
  });

  test("rejects a malformed header", () => {
    expect(verifyPaddleSignature("{}", "not-a-valid-header", secret)).toBe(false);
  });
});
