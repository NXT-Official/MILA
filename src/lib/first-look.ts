const FIRST_LOOK_KEY = "mila:firstLook";

/**
 * Onboarding leaves this behind so the dashboard opens by composing a look
 * instead of an empty prompt. sessionStorage, not localStorage: a handoff that
 * outlived the tab would ambush the member with a surprise credit spend.
 */
export function requestFirstLook() {
  try {
    sessionStorage.setItem(FIRST_LOOK_KEY, "pending");
  } catch {
    // Private mode or no storage — the dashboard just opens empty.
  }
}

/** Reads and clears together, so the handoff can only ever fire once. */
export function takeFirstLookHandoff(): boolean {
  try {
    if (sessionStorage.getItem(FIRST_LOOK_KEY) !== "pending") return false;
    sessionStorage.removeItem(FIRST_LOOK_KEY);
    return true;
  } catch {
    return false;
  }
}
