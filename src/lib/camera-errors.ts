/** Shown when the browser or the member's settings refuse camera access. */
export const CAMERA_BLOCKED_MESSAGE =
  "Camera Access Restricted. Please verify your browser site settings allow lens access and ensure you are using an HTTPS connection.";

const NO_CAMERA_MESSAGE = "No compatible camera was detected on this device.";

/**
 * The camera is there but won't start: another app (Zoom, Teams) is holding
 * it, the device dropped out, or the browser said something we don't know.
 * Upload is always on screen, so the copy points at it.
 */
export const CAMERA_BUSY_MESSAGE =
  "Your camera is busy in another app — close it and try again, or upload a photo instead.";

/** What to say while the browser's own permission prompt is still unanswered. */
export const CAMERA_PERMISSION_HINT =
  "Allow camera access in your browser's prompt, or upload a photo instead.";

/** How long the permission prompt can sit unanswered before the hint appears. */
export const PERMISSION_HINT_DELAY_MS = 3000;

function errorName(error: unknown): string {
  if (typeof error !== "object" || error === null || !("name" in error)) return "";
  const { name } = error;
  return typeof name === "string" ? name : "";
}

/**
 * Turns whatever `getUserMedia` threw into copy for the member. Browsers raise
 * a DOMException named for the cause and word it for developers ("Could not
 * start video source"); only the name is read here, so neither it nor the
 * browser's sentence ever reaches the screen.
 */
export function describeCameraError(error: unknown): string {
  switch (errorName(error)) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return CAMERA_BLOCKED_MESSAGE;
    case "NotFoundError":
    case "DevicesNotFoundError":
      return NO_CAMERA_MESSAGE;
    default:
      return CAMERA_BUSY_MESSAGE;
  }
}
