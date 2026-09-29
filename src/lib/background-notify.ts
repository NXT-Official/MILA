export type NotificationPermissionState = "default" | "granted" | "denied";

/**
 * Pure predicate: should a background OS notification fire, given the page's
 * visibility and the browser's Notification permission? Booleans/state are
 * injected rather than read from `document.hidden` / `Notification` directly
 * so this stays unit-testable without a DOM environment.
 */
export function shouldNotifyInBackground(deps: {
  documentHidden: boolean;
  notificationSupported: boolean;
  permission: NotificationPermissionState;
}): boolean {
  return deps.notificationSupported && deps.documentHidden && deps.permission === "granted";
}

/**
 * Fires a browser Notification when the tab is backgrounded and permission
 * was already granted; no-ops otherwise — including in a non-browser
 * environment, or when the tab is foregrounded, since the caller's existing
 * toast already covers that case.
 */
export function notifyIfBackgrounded(title: string, body?: string): void {
  const notificationSupported = typeof Notification !== "undefined";
  const documentHidden = typeof document !== "undefined" && document.hidden;
  const permission = notificationSupported ? Notification.permission : "denied";
  if (!shouldNotifyInBackground({ documentHidden, notificationSupported, permission })) return;
  new Notification(title, body ? { body } : undefined);
}

/**
 * Lazily requests Notification permission — call this from a user-initiated
 * action (e.g. "Create my look"), never on page load, since browsers
 * ignore or penalize unprompted permission requests. No-ops once the user
 * has already answered (granted or denied).
 */
export function requestNotificationPermission(): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}
