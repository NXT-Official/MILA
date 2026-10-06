import { describe, expect, test } from "bun:test";
import { createComposeBudget } from "./look";

const S = 1_000;
/** The plan has no fallback: whatever the review stage does, the plan's first
 * attempt must still be long enough to plausibly finish. */
const PLAN_MIN_ATTEMPT_MS = 45 * S;
/** Kept back from the 215s compose deadline so a timed-out plan still answers. */
const MARGIN_MS = 5 * S;

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createComposeBudget", () => {
  test("a review that times out is not retried — the fallback shortlist hands the plan its full attempt", () => {
    const c = clock();
    const budget = createComposeBudget(c.now);
    // Slow provider: the first review runs to its whole 85s budget.
    expect(budget.reviewTimeout()).toBe(85 * S);
    c.advance(budget.reviewTimeout());
    expect(budget.remainingMs()).toBe(130 * S);

    expect(budget.canRetryReview()).toBe(false);
    expect(budget.planTimeout()).toBe(105 * S);
  });

  test("a review that fails fast is retried with a full attempt", () => {
    const c = clock();
    const budget = createComposeBudget(c.now);
    c.advance(5 * S);

    expect(budget.canRetryReview()).toBe(true);
    expect(budget.reviewTimeout()).toBe(85 * S);
  });

  test("the review retry needs a full review attempt plus the plan's minimum plus the margin", () => {
    const c = clock();
    const budget = createComposeBudget(c.now);
    c.advance(80 * S); // 135s left = 85s review + 45s plan + 5s margin
    expect(budget.canRetryReview()).toBe(true);
    c.advance(1);
    expect(budget.canRetryReview()).toBe(false);
  });

  test("no review-stage call can leave the plan less than its minimum attempt", () => {
    // Every review-stage call after the first (the retry, the thin-shortlist
    // recheck) is gated by canRetryReview, so it is enough that the worst
    // case of ANY gated call — running to its whole clamped timeout — still
    // leaves the plan its minimum, finishing inside the deadline's margin.
    let gatedCalls = 0;
    const starved: Array<{ callAtS: number; planS: number; leftAfterPlanS: number }> = [];
    for (let elapsedMs = 0; elapsedMs <= 215 * S; elapsedMs += S) {
      const c = clock();
      const budget = createComposeBudget(c.now);
      c.advance(elapsedMs);
      if (!budget.canRetryReview()) continue;

      gatedCalls += 1;
      c.advance(budget.reviewTimeout());
      const planMs = budget.planTimeout();
      const leftAfterPlanMs = budget.remainingMs() - planMs;
      if (planMs < PLAN_MIN_ATTEMPT_MS || leftAfterPlanMs < MARGIN_MS) {
        starved.push({
          callAtS: elapsedMs / S,
          planS: planMs / S,
          leftAfterPlanS: leftAfterPlanMs / S,
        });
      }
    }
    expect(gatedCalls).toBeGreaterThan(0);
    expect(starved).toEqual([]);
  });

  test("the plan retry still runs whenever a minimum attempt fits", () => {
    const c = clock();
    const budget = createComposeBudget(c.now);
    c.advance(165 * S); // 50s left = 45s attempt + 5s margin
    expect(budget.canRetryPlan()).toBe(true);
    expect(budget.planTimeout()).toBe(PLAN_MIN_ATTEMPT_MS);
    c.advance(1);
    expect(budget.canRetryPlan()).toBe(false);
  });

  test("a clamped attempt never drops below a usable call", () => {
    const c = clock();
    const budget = createComposeBudget(c.now);
    c.advance(210 * S);
    expect(budget.planTimeout()).toBe(12 * S);
  });
});
