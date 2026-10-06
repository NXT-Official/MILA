/** Shown next to the buttons that stay locked until the style sheet finishes drawing. */
export const STYLE_SHEET_BUSY_REASON = "Finishing your style sheet…";

/** Shown next to the buttons that stay locked until the portrait preview finishes rendering. */
export const PHOTO_PREVIEW_BUSY_REASON = "Finishing your portrait…";

/**
 * Tells a style-sheet or portrait-preview request whether it is still the live
 * one when it finishes. `start()` hands out a token and makes every earlier token stale;
 * `invalidate()` makes all of them stale (a new look is being composed, so
 * nothing in flight belongs to it). A late result checks `isCurrent(token)`
 * before touching the screen, so a sheet or portrait drawn for an old look can
 * never land on the new look's text or stop the new look's spinner. Each kind
 * of request keeps its own run, so one never retires the other.
 */
export function createLatestRun() {
  let latest = 0;
  return {
    start(): number {
      latest += 1;
      return latest;
    },
    invalidate(): void {
      latest += 1;
    },
    isCurrent(token: number): boolean {
      return token === latest;
    },
  };
}
