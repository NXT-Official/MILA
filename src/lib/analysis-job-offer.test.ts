import { describe, expect, test } from "bun:test";
import {
  ANALYSIS_DISMISSED_LIMIT,
  ANALYSIS_OFFER_WINDOW_MS,
  ANALYSIS_POLL_MS,
  ANALYSIS_REAP_GRACE_MS,
  PERSIST_FAILED_DELIVERED,
  analysisJobOffer,
  rememberDismissed,
  type AnalysisJobLike,
} from "./analysis-job-offer";

// Golden vectors: fixed clock, PostgREST-style timestamps (microseconds,
// +00:00). Mobile copies these verbatim.
const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function job(overrides: Partial<AnalysisJobLike> = {}): AnalysisJobLike {
  return {
    id: "job-1",
    status: "succeeded",
    result: { silhouette: "Hourglass" },
    errorCode: null,
    deadlineAt: "2026-10-07T11:05:00.000000+00:00",
    completedAt: "2026-10-07T11:01:30.123456+00:00",
    ...overrides,
  };
}

describe("analysis job constants", () => {
  test("match the shared contract (section 3.5)", () => {
    expect(ANALYSIS_POLL_MS).toBe(3_000);
    expect(ANALYSIS_REAP_GRACE_MS).toBe(30_000);
    expect(ANALYSIS_OFFER_WINDOW_MS).toBe(12 * 60 * 60 * 1000);
    expect(ANALYSIS_DISMISSED_LIMIT).toBe(20);
    expect(PERSIST_FAILED_DELIVERED).toBe("persist_failed_delivered");
  });
});

describe("analysisJobOffer", () => {
  test("running, stale, ready within 12 hours, failed, never a persist_failed_delivered row, never her used or applied job, never a dismissed job", () => {
    // running: up to deadline + 30 s, inclusive.
    const running = job({
      status: "running",
      completedAt: null,
      deadlineAt: "2026-10-07T11:59:30.000000+00:00",
    });
    expect(analysisJobOffer(running, { now: NOW })).toBe("running");
    expect(
      analysisJobOffer(job({ ...running, deadlineAt: "2026-10-07T12:00:30.000000+00:00" }), {
        now: NOW,
      }),
    ).toBe("running");

    // stale: running one millisecond past deadline + 30 s.
    expect(
      analysisJobOffer(job({ ...running, deadlineAt: "2026-10-07T11:59:29.999000+00:00" }), {
        now: NOW,
      }),
    ).toBe("stale");

    // ready within 12 hours; exactly 12 hours is still ready, a moment later is not
    // (on another local day: the calendar is pinned so this holds in every time zone).
    const otherDay = () => false;
    expect(analysisJobOffer(job(), { now: NOW })).toBe("ready");
    expect(
      analysisJobOffer(job({ completedAt: "2026-10-07T00:00:00+00:00" }), {
        now: NOW,
        sameLocalDay: otherDay,
      }),
    ).toBe("ready");
    expect(
      analysisJobOffer(job({ completedAt: "2026-10-06T23:59:59.999+00:00" }), {
        now: NOW,
        sameLocalDay: otherDay,
      }),
    ).toBeNull();

    // failed within 12 hours.
    const failed = job({ status: "failed", result: null, errorCode: "provider_error" });
    expect(analysisJobOffer(failed, { now: NOW })).toBe("failed");
    expect(
      analysisJobOffer(job({ ...failed, completedAt: "2026-10-06T11:00:00+00:00" }), { now: NOW }),
    ).toBeNull();

    // A delivered-and-charged row is never a failure.
    expect(
      analysisJobOffer(job({ ...failed, errorCode: PERSIST_FAILED_DELIVERED }), { now: NOW }),
    ).toBeNull();

    // Never her used job (color_read) or a job she already applied (check_in).
    expect(analysisJobOffer(job(), { now: NOW, usedJobId: "job-1" })).toBeNull();
    expect(analysisJobOffer(job(), { now: NOW, usedJobId: "job-0" })).toBe("ready");
    expect(
      analysisJobOffer(job(), { now: NOW, appliedAt: "2026-10-07T11:01:30.123456+00:00" }),
    ).toBeNull();
    expect(
      analysisJobOffer(job(), { now: NOW, appliedAt: "2026-10-07T11:30:00.000000+00:00" }),
    ).toBeNull();
    expect(analysisJobOffer(job(), { now: NOW, appliedAt: "2026-10-07T11:01:30.122+00:00" })).toBe(
      "ready",
    );
    expect(analysisJobOffer(job(), { now: NOW, appliedAt: null })).toBe("ready");

    // Never a dismissed job, ready or failed.
    expect(analysisJobOffer(job(), { now: NOW, dismissedIds: ["job-1"] })).toBeNull();
    expect(analysisJobOffer(failed, { now: NOW, dismissedIds: ["job-1"] })).toBeNull();
    expect(analysisJobOffer(job(), { now: NOW, dismissedIds: ["job-2"] })).toBe("ready");
  });

  test("offers a job finished on her local day, or within 12 hours (the shared recovery rule)", () => {
    // Local wall-clock times, so these hold in every time zone.
    const at = (day: number, h: number, m = 0, s = 0, ms = 0) =>
      new Date(2026, 9, day, h, m, s, ms).getTime();
    const iso = (time: number) => new Date(time).toISOString();
    const failed = { status: "failed", result: null, errorCode: "provider_error" };

    // Earlier today always counts, however long ago: 00:30, opened at 23:00.
    expect(analysisJobOffer(job({ completedAt: iso(at(7, 0, 30)) }), { now: at(7, 23) })).toBe(
      "ready",
    );
    expect(
      analysisJobOffer(job({ ...failed, completedAt: iso(at(7, 0, 30)) }), { now: at(7, 23) }),
    ).toBe("failed");

    // Across midnight within 12 hours: 23:58 still counts at 00:02.
    expect(analysisJobOffer(job({ completedAt: iso(at(6, 23, 58)) }), { now: at(7, 0, 2) })).toBe(
      "ready",
    );
    expect(
      analysisJobOffer(job({ ...failed, completedAt: iso(at(6, 23, 58)) }), { now: at(7, 0, 2) }),
    ).toBe("failed");

    // Yesterday 23:30: exactly 12 hours counts, one millisecond more does not.
    expect(analysisJobOffer(job({ completedAt: iso(at(6, 23, 30)) }), { now: at(7, 11, 30) })).toBe(
      "ready",
    );
    expect(
      analysisJobOffer(job({ completedAt: iso(at(6, 23, 30)) }), { now: at(7, 11, 30, 0, 1) }),
    ).toBeNull();

    // No completed_at: created_at is when it finished.
    expect(
      analysisJobOffer(job({ completedAt: null, createdAt: iso(at(7, 8)) }), { now: at(7, 9) }),
    ).toBe("ready");

    // The calendar can be injected.
    expect(
      analysisJobOffer(job({ completedAt: iso(at(5, 8)) }), {
        now: at(7, 9),
        sameLocalDay: () => true,
      }),
    ).toBe("ready");
  });

  test("a colour read respects appliedAt like the others: a profile saved after it hides it", () => {
    // usedJobId is another read, but she saved her colours (a quiz) after this one finished.
    expect(
      analysisJobOffer(job(), {
        now: NOW,
        usedJobId: "job-0",
        appliedAt: "2026-10-07T11:30:00.000000+00:00",
      }),
    ).toBeNull();
    expect(
      analysisJobOffer(job(), {
        now: NOW,
        usedJobId: "job-0",
        appliedAt: "2026-10-07T10:00:00.000000+00:00",
      }),
    ).toBe("ready");
  });

  test("a result check that throws, or answers anything but true, is not offerable", () => {
    const throwing = () => {
      throw new Error("unexpected shape");
    };
    expect(analysisJobOffer(job(), { now: NOW, resultParses: throwing })).toBeNull();
    const notBoolean = (() => ({ success: false })) as unknown as (result: unknown) => boolean;
    expect(analysisJobOffer(job(), { now: NOW, resultParses: notBoolean })).toBeNull();
  });

  test("a result that does not parse is never offered as ready", () => {
    expect(analysisJobOffer(job({ result: null }), { now: NOW })).toBeNull();
    expect(analysisJobOffer(job({ result: "text" }), { now: NOW })).toBeNull();
    expect(analysisJobOffer(job({ result: [1] }), { now: NOW })).toBeNull();
    const silhouetteOnly = (result: unknown) =>
      typeof result === "object" && result !== null && "silhouette" in result;
    expect(analysisJobOffer(job(), { now: NOW, resultParses: silhouetteOnly })).toBe("ready");
    expect(
      analysisJobOffer(job({ result: { other: 1 } }), { now: NOW, resultParses: silhouetteOnly }),
    ).toBeNull();
  });

  test("no job, an unknown status or an unreadable time offers nothing", () => {
    expect(analysisJobOffer(null, { now: NOW })).toBeNull();
    expect(analysisJobOffer(undefined, { now: NOW })).toBeNull();
    expect(analysisJobOffer(job({ status: "queued" }), { now: NOW })).toBeNull();
    expect(analysisJobOffer(job({ completedAt: null }), { now: NOW })).toBeNull();
    expect(analysisJobOffer(job({ completedAt: "not a time" }), { now: NOW })).toBeNull();
    expect(
      analysisJobOffer(job({ status: "running", completedAt: null, deadlineAt: "soon" }), {
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("rememberDismissed", () => {
  test("keeps the last 20 ids, newest last, without duplicates", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `job-${i}`);
    const next = rememberDismissed(ids, "job-20");
    expect(next).toHaveLength(20);
    expect(next[0]).toBe("job-1");
    expect(next[19]).toBe("job-20");
    expect(rememberDismissed(["a", "b"], "a")).toEqual(["b", "a"]);
    expect(rememberDismissed([], "a")).toEqual(["a"]);
  });

  test("never mutates the list it was given", () => {
    const ids = ["a"];
    rememberDismissed(ids, "b");
    expect(ids).toEqual(["a"]);
  });
});
