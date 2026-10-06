import { describe, expect, test } from "bun:test";
import { createRenderBudget } from "./render-budget";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRenderBudget", () => {
  test("a retry can start after a fast failed attempt", () => {
    const c = clock();
    const budget = createRenderBudget(280_000, c.now);
    c.advance(90_000); // one real attempt: render + QA rejection
    expect(budget.canStart(100_000)).toBe(true);
  });

  test("no attempt starts once a whole render + check can't finish", () => {
    const c = clock();
    const budget = createRenderBudget(280_000, c.now);
    c.advance(200_000);
    expect(budget.canStart(100_000)).toBe(false);
  });

  test("clamp leaves the reserve for the QA call", () => {
    const c = clock();
    const budget = createRenderBudget(280_000, c.now);
    c.advance(150_000); // 130s left
    expect(budget.clamp(150_000, 40_000)).toBe(90_000);
    expect(budget.clamp(60_000, 40_000)).toBe(60_000);
  });

  test("clamp never returns less than a usable call", () => {
    const c = clock();
    const budget = createRenderBudget(280_000, c.now);
    c.advance(279_000);
    expect(budget.clamp(110_000)).toBe(15_000);
  });
});
