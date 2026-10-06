import { describe, expect, test } from "bun:test";
import {
  CAMERA_BUSY_MESSAGE,
  CAMERA_PERMISSION_HINT,
  PERMISSION_HINT_DELAY_MS,
  describeCameraError,
} from "./camera-errors";

/** What a browser throws when getUserMedia fails: a DOMException named for the cause. */
function cameraError(name: string, message = "Could not start video source") {
  return new DOMException(message, name);
}

describe("describeCameraError", () => {
  test.each(["NotAllowedError", "SecurityError", "PermissionDeniedError"])(
    "%s points the member at their browser's camera settings",
    (name) => {
      expect(describeCameraError(cameraError(name))).toContain("site settings");
    },
  );

  test.each(["NotFoundError", "DevicesNotFoundError"])("%s says there is no camera", (name) => {
    expect(describeCameraError(cameraError(name))).toBe(
      "No compatible camera was detected on this device.",
    );
  });

  // A laptop camera held by Zoom or Teams raises NotReadableError; the browser's own
  // sentence ("Could not start video source") is not something to show a member.
  test.each(["NotReadableError", "TrackStartError", "AbortError", "OverconstrainedError"])(
    "%s says the camera is busy and offers an upload instead",
    (name) => {
      const message = describeCameraError(cameraError(name));
      expect(message).toBe(CAMERA_BUSY_MESSAGE);
      expect(message).toContain("busy in another app");
      expect(message).toContain("upload a photo instead");
    },
  );

  test("an error nobody anticipated gets the busy copy, never the browser's text", () => {
    expect(
      describeCameraError(new Error("Failed to execute 'getUserMedia' on 'MediaDevices'")),
    ).toBe(CAMERA_BUSY_MESSAGE);
    expect(describeCameraError(cameraError("InvalidStateError", "raw browser text"))).toBe(
      CAMERA_BUSY_MESSAGE,
    );
  });

  test("a thrown value that is not an Error still gets the busy copy", () => {
    expect(describeCameraError(undefined)).toBe(CAMERA_BUSY_MESSAGE);
    expect(describeCameraError("boom")).toBe(CAMERA_BUSY_MESSAGE);
    expect(describeCameraError({ name: 42 })).toBe(CAMERA_BUSY_MESSAGE);
  });

  test("no copy names a DOMException or quotes the browser", () => {
    const names = ["NotReadableError", "AbortError", "OverconstrainedError", "NotFoundError"];
    for (const name of names) {
      const message = describeCameraError(cameraError(name));
      expect(message).not.toMatch(/Error\b/);
      expect(message).not.toContain("video source");
    }
  });
});

describe("the camera permission hint", () => {
  test("waits about three seconds before it appears", () => {
    expect(PERMISSION_HINT_DELAY_MS).toBe(3000);
  });

  test("tells the member where to allow access and keeps upload in reach", () => {
    expect(CAMERA_PERMISSION_HINT).toBe(
      "Allow camera access in your browser's prompt, or upload a photo instead.",
    );
  });
});
