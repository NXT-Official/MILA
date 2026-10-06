import { describe, expect, test } from "bun:test";
import { INSUFFICIENT_CREDITS } from "./credits";
import { describeColorReadError } from "./color-read-errors";

/** Every `error` string `analyzePersonalColorForUser` can return (see the service). */
const SLOW_CODES = ["SERVER_GATEWAY_TIMEOUT", "ANALYSIS_GATEWAY_FAILURE"] as const;
const UNAVAILABLE_CODES = ["CONFIG_MISSING_API_KEY", "ANALYSIS_CREDITS_EXHAUSTED"] as const;

const RAW_CODE = /[A-Z]{2,}_[A-Z_]+/;

describe("describeColorReadError", () => {
  test.each(SLOW_CODES)("%s reads as Mila taking longer than usual", (code) => {
    const failure = describeColorReadError(code);
    expect(failure.message).toMatch(/longer than usual/i);
    expect(failure.message).toMatch(/try again/i);
    expect(failure.outOfCredits).toBe(false);
  });

  test("a rate limit asks the member to try again later", () => {
    const failure = describeColorReadError("ANALYSIS_RATE_LIMITED");
    expect(failure.message).toMatch(/too many|a lot of/i);
    expect(failure.message).toMatch(/try again later/i);
    expect(failure.outOfCredits).toBe(false);
  });

  test("a parsing failure points at the photo and the light", () => {
    const failure = describeColorReadError("ANALYSIS_PARSING_FAILED");
    expect(failure.message).toMatch(/photo/i);
    expect(failure.message).toMatch(/light/i);
    expect(failure.outOfCredits).toBe(false);
  });

  test("the member's own out-of-credits answer opens the upgrade dialog", () => {
    const failure = describeColorReadError(INSUFFICIENT_CREDITS);
    expect(failure.outOfCredits).toBe(true);
    expect(failure.message.length).toBeGreaterThan(0);
  });

  test.each(UNAVAILABLE_CODES)("%s gets the generic line and never the paywall", (code) => {
    const failure = describeColorReadError(code);
    expect(failure).toEqual(describeColorReadError("SOMETHING_NEW_FROM_THE_SERVER"));
    expect(failure.outOfCredits).toBe(false);
  });

  test("an unknown code gets a friendly generic line, not the code", () => {
    const failure = describeColorReadError("SOMETHING_NEW_FROM_THE_SERVER");
    expect(failure.message).toMatch(/try again/i);
    expect(failure.message).not.toContain("SOMETHING_NEW_FROM_THE_SERVER");
    expect(failure.outOfCredits).toBe(false);
  });

  test("a missing or empty code still gets the generic line", () => {
    const generic = describeColorReadError("SOMETHING_NEW_FROM_THE_SERVER");
    expect(describeColorReadError(undefined)).toEqual(generic);
    expect(describeColorReadError(null)).toEqual(generic);
    expect(describeColorReadError("")).toEqual(generic);
  });

  test("object-prototype names are not mistaken for codes", () => {
    const generic = describeColorReadError("SOMETHING_NEW_FROM_THE_SERVER");
    expect(describeColorReadError("constructor")).toEqual(generic);
    expect(describeColorReadError("__proto__")).toEqual(generic);
  });

  test("no member-facing line leaks a raw code, a status or an env var", () => {
    const codes = [
      ...SLOW_CODES,
      ...UNAVAILABLE_CODES,
      "ANALYSIS_RATE_LIMITED",
      "ANALYSIS_PARSING_FAILED",
      INSUFFICIENT_CREDITS,
      "SOMETHING_NEW_FROM_THE_SERVER",
    ];
    for (const code of codes) {
      const { message } = describeColorReadError(code);
      expect(message).not.toMatch(RAW_CODE);
      expect(message).not.toMatch(/\b(api key|openrouter|http|\d{3})\b/i);
    }
  });
});
