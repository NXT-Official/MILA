import { describe, expect, test } from "bun:test";
import { computeStreakDays } from "./dashboard-stats";

const now = new Date(2026, 9, 7, 15, 0, 0);
const day = (offset: number) => new Date(2026, 9, 7 - offset, 10, 0, 0).toISOString();

describe("computeStreakDays", () => {
  test("counts today and the days before it", () => {
    expect(computeStreakDays([day(0), day(1), day(2)], now)).toBe(3);
  });

  test("keeps a streak alive through yesterday when there is no look yet today", () => {
    expect(computeStreakDays([day(1), day(2)], now)).toBe(2);
  });

  test("breaks when yesterday also has no look", () => {
    expect(computeStreakDays([day(2), day(3)], now)).toBe(0);
  });

  test("is 0 with no looks", () => {
    expect(computeStreakDays([], now)).toBe(0);
  });
});

describe("computeStreakDays uses her local day, not the UTC day", () => {
  const originalTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  test("Manila (UTC+8): two looks that share a UTC date are two local days", () => {
    process.env.TZ = "Asia/Manila";
    try {
      expect(new Date("2026-10-07T04:00:00Z").getDate()).toBe(7); // proves bun honours TZ
      const now = new Date("2026-10-07T04:00:00Z"); // 12:00 on Oct 7, Manila
      // 00:30 Oct 7 and 23:30 Oct 6 in Manila; both are Oct 6 in UTC.
      const looks = ["2026-10-06T16:30:00Z", "2026-10-06T15:30:00Z"];
      // Local days: Oct 7 + Oct 6 = 2. Counting UTC days would give 1.
      expect(computeStreakDays(looks, now)).toBe(2);
    } finally {
      process.env.TZ = originalTz;
    }
  });
});
