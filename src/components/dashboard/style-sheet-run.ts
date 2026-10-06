/** Shown next to the buttons that stay locked until the style sheet finishes drawing. */
export const STYLE_SHEET_BUSY_REASON = "Finishing your style sheet…";

/**
 * Tells a style-sheet request whether it is still the live one when it
 * finishes. `start()` hands out a token and makes every earlier token stale;
 * `invalidate()` makes all of them stale (a new look is being composed, so
 * nothing in flight belongs to it). A late result checks `isCurrent(token)`
 * before touching the screen, so a sheet drawn for an old look can never land
 * on the new look's text or stop the new look's spinner.
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
