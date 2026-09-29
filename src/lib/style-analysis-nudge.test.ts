import { describe, expect, test } from "bun:test";
import {
  isSnoozed,
  isStyleAnalysisStale,
  snoozeUntil,
  STYLE_ANALYSIS_NUDGE_SNOOZE_KEY,
} from "./style-analysis-nudge";

describe("isStyleAnalysisStale", () => {
  const now = new Date("2026-09-28T00:00:00.000Z");

  test("false when there's no completion on record", () => {
    expect(isStyleAnalysisStale(null, now)).toBe(false);
  });

  test("false when the completion timestamp is malformed", () => {
    expect(isStyleAnalysisStale("not-a-date", now)).toBe(false);
  });

  test("false just under the 90-day threshold", () => {
    const last = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStyleAnalysisStale(last, now)).toBe(false);
  });

  test("true at and beyond the 90-day threshold", () => {
    const exactly90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const wellPast = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStyleAnalysisStale(exactly90, now)).toBe(true);
    expect(isStyleAnalysisStale(wellPast, now)).toBe(true);
  });
});

describe("isSnoozed / snoozeUntil", () => {
  const now = new Date("2026-09-28T00:00:00.000Z");

  test("not snoozed when nothing is stored", () => {
    expect(isSnoozed(now, () => null)).toBe(false);
  });

  test("not snoozed when the stored value is malformed", () => {
    expect(isSnoozed(now, () => "not-a-date")).toBe(false);
  });

  test("snoozed while now is before the stored snooze-until timestamp", () => {
    const store: Record<string, string> = {
      [STYLE_ANALYSIS_NUDGE_SNOOZE_KEY]: new Date(now.getTime() + 1000).toISOString(),
    };
    expect(isSnoozed(now, (k) => store[k] ?? null)).toBe(true);
  });

  test("no longer snoozed once now passes the stored timestamp", () => {
    const store: Record<string, string> = {
      [STYLE_ANALYSIS_NUDGE_SNOOZE_KEY]: new Date(now.getTime() - 1000).toISOString(),
    };
    expect(isSnoozed(now, (k) => store[k] ?? null)).toBe(false);
  });

  test("snoozeUntil produces a timestamp 30 days ahead", () => {
    const until = new Date(snoozeUntil(now));
    const diffDays = (until.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(30);
  });
});
