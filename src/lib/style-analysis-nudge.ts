/**
 * Pure logic for the periodic "refresh your style analysis" nudge (Style
 * Profile page only). `lastCompletedAt` is the most recent
 * `onboarding_completed` analytics_events row for the user — set both by
 * first-time onboarding and by RestartStyleAnalysisAction's full re-run, so
 * one query covers both. Day-based thresholds (not calendar months) avoid
 * variable-month-length edge cases.
 */

/** ~3 months. */
export const STYLE_ANALYSIS_NUDGE_THRESHOLD_DAYS = 90;
export const STYLE_ANALYSIS_NUDGE_SNOOZE_DAYS = 30;
export const STYLE_ANALYSIS_NUDGE_SNOOZE_KEY = "mila:style-analysis-nudge-snoozed-until";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True once STYLE_ANALYSIS_NUDGE_THRESHOLD_DAYS have passed since the user's
 * last completed analysis. A user with no completion on record (pre-dates
 * this tracking, or never actually finished onboarding) is never nudged —
 * there's nothing to compare against, and RestartStyleAnalysisAction already
 * gives them a manual way in.
 */
export function isStyleAnalysisStale(
  lastCompletedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!lastCompletedAt) return false;
  const last = new Date(lastCompletedAt);
  if (Number.isNaN(last.getTime())) return false;
  return (now.getTime() - last.getTime()) / MS_PER_DAY >= STYLE_ANALYSIS_NUDGE_THRESHOLD_DAYS;
}

/** `getItem` is injected (rather than reading `window.localStorage`
 * directly) so this stays a pure, unit-testable function. */
export function isSnoozed(now: Date, getItem: (key: string) => string | null): boolean {
  const until = getItem(STYLE_ANALYSIS_NUDGE_SNOOZE_KEY);
  if (!until) return false;
  const untilDate = new Date(until);
  if (Number.isNaN(untilDate.getTime())) return false;
  return now.getTime() < untilDate.getTime();
}

/** The ISO timestamp to store under STYLE_ANALYSIS_NUDGE_SNOOZE_KEY when the
 * user dismisses the nudge. */
export function snoozeUntil(now: Date): string {
  return new Date(now.getTime() + STYLE_ANALYSIS_NUDGE_SNOOZE_DAYS * MS_PER_DAY).toISOString();
}
