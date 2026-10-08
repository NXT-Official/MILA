import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DELIVERED_NOT_SAVED,
  DELIVERED_NOT_SAVED_MESSAGE,
  isDeliveredNotSaved,
} from "./generation-error-codes";

describe("generation error codes (client-safe)", () => {
  test("the delivered-but-unsaved code and copy are stable, calm and dash-free", () => {
    expect(DELIVERED_NOT_SAVED).toBe("DELIVERED_NOT_SAVED");
    expect(DELIVERED_NOT_SAVED_MESSAGE).toBe(
      "This result was made, but it couldn't be saved, so it can't be shown again. You won't be charged again for it.",
    );
    expect(DELIVERED_NOT_SAVED_MESSAGE).not.toMatch(/[—–]/);
  });

  test("matches structurally: a thrown error, an /api/v1 error body, or the message alone", () => {
    expect(isDeliveredNotSaved({ code: "DELIVERED_NOT_SAVED", message: "x" })).toBe(true);
    expect(isDeliveredNotSaved(new Error(DELIVERED_NOT_SAVED_MESSAGE))).toBe(true);
    expect(isDeliveredNotSaved({ code: "RATE_LIMITED", message: "Try again." })).toBe(false);
    expect(isDeliveredNotSaved(new Error("Dupe extraction failed."))).toBe(false);
    expect(isDeliveredNotSaved(null)).toBe(false);
    expect(isDeliveredNotSaved("DELIVERED_NOT_SAVED")).toBe(false);
  });

  test("imports nothing, so any client bundle can use it", () => {
    const source = readFileSync(join(import.meta.dir, "generation-error-codes.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
