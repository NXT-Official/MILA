import { describe, expect, test } from "bun:test";
import {
  EMPTY_RESULT_CODES,
  FEATURE_JOB_KINDS,
  OFFER_WINDOW_MS,
  PERSIST_FAILED_DELIVERED,
  featureFailureCopy,
  featureJobOffer,
  featureOfferLabel,
  type FeatureJobLike,
} from "./feature-job-offer";

const at = (day: number, h: number, m = 0, s = 0, ms = 0) =>
  new Date(2026, 9, day, h, m, s, ms).getTime();
const iso = (t: number) => new Date(t).toISOString();

function job(overrides: Partial<FeatureJobLike> = {}): FeatureJobLike {
  return {
    id: "job-1",
    kind: "lens_analysis",
    client_request_id: "req-1",
    status: "succeeded",
    credit_state: "charged",
    result: { overall_score: 80 },
    error_code: null,
    deadline_at: iso(at(7, 12, 5)),
    created_at: iso(at(7, 12, 0)),
    completed_at: iso(at(7, 12, 1)),
    ...overrides,
  };
}

describe("featureJobOffer", () => {
  test("no job gives null", () => {
    expect(featureJobOffer(null, { now: at(7, 13) })).toBeNull();
    expect(featureJobOffer(undefined, { now: at(7, 13) })).toBeNull();
  });

  test("running flips to stale just after deadline + 45 s", () => {
    const deadline = at(7, 12, 5);
    const running = job({ status: "running", completed_at: null, deadline_at: iso(deadline) });
    expect(featureJobOffer(running, { now: deadline + 45_000 })).toBe("running");
    expect(featureJobOffer(running, { now: deadline + 45_001 })).toBe("stale");
  });

  test("a running row with an unreadable deadline is null", () => {
    expect(featureJobOffer(job({ status: "running", deadline_at: "nope" }), { now: 1 })).toBeNull();
  });

  test("finished 23:58, opened 00:05: ready and labelled last night", () => {
    const done = job({ completed_at: iso(at(6, 23, 58)) });
    const now = at(7, 0, 5);
    expect(featureJobOffer(done, { now })).toBe("ready");
    expect(featureOfferLabel(done, now)).toBe("From last night, 11:58 PM");
  });

  test("an afternoon row from yesterday is labelled yesterday", () => {
    const done = job({ completed_at: iso(at(6, 17, 5)) });
    expect(featureOfferLabel(done, at(7, 6, 0))).toBe("From yesterday, 5:05 PM");
  });

  test("a row from today has no label", () => {
    expect(featureOfferLabel(job(), at(7, 20))).toBeNull();
  });

  test("the 12 h edge is offered, 12 h + 1 ms is not (different day)", () => {
    const completed = at(5, 14, 0);
    const done = job({ completed_at: iso(completed) });
    expect(featureJobOffer(done, { now: completed + OFFER_WINDOW_MS })).toBe("ready");
    expect(featureJobOffer(done, { now: completed + OFFER_WINDOW_MS + 1 })).toBeNull();
  });

  test("older than 12 h but the same local day is still offered", () => {
    const done = job({ completed_at: iso(at(7, 0, 5)) });
    expect(featureJobOffer(done, { now: at(7, 23, 0) })).toBe("ready");
  });

  test("completed_at missing falls back to created_at", () => {
    const done = job({ completed_at: null, created_at: iso(at(5, 9)) });
    expect(featureJobOffer(done, { now: at(7, 9) })).toBeNull();
  });

  test("sameLocalDay can be injected", () => {
    const done = job({ completed_at: iso(at(1, 9)) });
    expect(featureJobOffer(done, { now: at(7, 9), sameLocalDay: () => true })).toBe("ready");
  });

  test("a dismissed row gives null", () => {
    expect(featureJobOffer(job(), { now: at(7, 13), dismissed: ["job-1"] })).toBeNull();
  });

  test("an empty code gives empty", () => {
    for (const code of EMPTY_RESULT_CODES) {
      const empty = job({ status: "failed", error_code: code, credit_state: "refunded" });
      expect(featureJobOffer(empty, { now: at(7, 13) })).toBe("empty");
    }
  });

  test("persist_failed_delivered is never a failure", () => {
    const delivered = job({ status: "failed", error_code: PERSIST_FAILED_DELIVERED });
    expect(featureJobOffer(delivered, { now: at(7, 13) })).toBeNull();
  });

  test("any other failure is failed", () => {
    const failed = job({ status: "failed", error_code: "deadline_exceeded" });
    expect(featureJobOffer(failed, { now: at(7, 13) })).toBe("failed");
  });

  test("an unknown status is null", () => {
    expect(featureJobOffer(job({ status: "weird" }), { now: at(7, 13) })).toBeNull();
  });
});

describe("featureFailureCopy", () => {
  test("every kind has a refunded and a plain line, with no dashes", () => {
    for (const kind of FEATURE_JOB_KINDS) {
      const refunded = featureFailureCopy(kind, true);
      const plain = featureFailureCopy(kind, false);
      expect(refunded).toContain("Your credit is back.");
      expect(plain).toContain("Please try again.");
      expect(`${refunded}${plain}`).not.toMatch(/[–—]/);
    }
  });

  test("lens copy is the plan's L9", () => {
    expect(featureFailureCopy("lens_analysis", true)).toBe(
      "Mila couldn't finish reading your photo. Your credit is back.",
    );
  });
});

describe("golden vector: 00:30 finished, opened 23:00 the same day", () => {
  test("offered as ready (same local day, 22.5 h old) with no label", () => {
    const done = job({ completed_at: iso(at(7, 0, 30)) });
    const now = at(7, 23, 0);
    expect(featureJobOffer(done, { now })).toBe("ready");
    expect(featureOfferLabel(done, now)).toBeNull();
  });

  test("the same row the next morning is gone", () => {
    const done = job({ completed_at: iso(at(7, 0, 30)) });
    expect(featureJobOffer(done, { now: at(8, 13, 0) })).toBeNull();
  });
});
