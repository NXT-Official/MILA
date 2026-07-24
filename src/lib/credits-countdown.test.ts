import { describe, expect, test } from "bun:test";
import { formatResetCountdown } from "./credits-countdown";

describe("formatResetCountdown", () => {
  test("counts down to the next UTC midnight", () => {
    expect(formatResetCountdown(new Date("2026-07-24T23:45:00Z"))).toBe("0h 15m");
  });

  test("shows a full day right after a reset", () => {
    expect(formatResetCountdown(new Date("2026-07-24T00:00:00Z"))).toBe("24h 0m");
  });

  test("rounds up partial minutes so it never shows a stale zero", () => {
    expect(formatResetCountdown(new Date("2026-07-24T23:59:30Z"))).toBe("0h 1m");
  });
});
