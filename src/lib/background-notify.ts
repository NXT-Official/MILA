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
  const options = body ? { body } : undefined;
  try {
    new Notification(title, options);
  } catch {
    // src: https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification#exceptions
    // · MDN, 2026-10-07: the constructor throws TypeError on Android Chrome, which
    // requires ServiceWorkerRegistration.showNotification() instead.
    showViaServiceWorker(title, options);
  }
}

function showViaServiceWorker(title: string, options: NotificationOptions | undefined): void {
  try {
    if (typeof navigator === "undefined" || !navigator.serviceWorker?.getRegistration) return;
    // getRegistration() resolves undefined when none is registered; `ready` would hang forever.
    // src: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/getRegistration
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.showNotification(title, options))
      .catch(() => undefined);
  } catch {
    // No service worker available: skip silently, never throw into the caller.
  }
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
