/**
 * Time budget for the look-visual renders (style sheet, photo preview).
 *
 * Vercel kills the function at 300s; a killed request reaches the member as a
 * bare timeout with nothing refunded or re-marked. Every attempt therefore
 * runs on the time actually left: provider calls are clamped to it, and a new
 * attempt only starts when a whole render + check can still finish. A fixed
 * worst-case estimate (the old 150s + 110s against 280s) meant a QA retry
 * could essentially never start — the "3 attempts" were one.
 */
export const RENDER_FUNCTION_BUDGET_MS = 280_000;
/** Below this, no single provider call is worth starting. */
const MIN_CALL_MS = 15_000;

export type RenderBudget = {
  remainingMs: () => number;
  /** Can an attempt needing at least `minAttemptMs` still finish? */
  canStart: (minAttemptMs: number) => boolean;
  /** `preferredMs`, cut down so `reserveMs` is left for what follows it. */
  clamp: (preferredMs: number, reserveMs?: number) => number;
};

export function createRenderBudget(
  budgetMs: number = RENDER_FUNCTION_BUDGET_MS,
  now: () => number = Date.now,
): RenderBudget {
  const startedAt = now();
  const remainingMs = () => budgetMs - (now() - startedAt);
  return {
    remainingMs,
    canStart: (minAttemptMs) => remainingMs() >= minAttemptMs,
    clamp: (preferredMs, reserveMs = 0) =>
      Math.max(MIN_CALL_MS, Math.min(preferredMs, remainingMs() - reserveMs)),
  };
}
