import { describe, expect, test, afterEach } from "bun:test";
import { openCamera } from "./capture-frame";

const realMedia = globalThis.navigator?.mediaDevices;

function stubGetUserMedia(impl: (c: MediaStreamConstraints) => Promise<MediaStream>) {
  const calls: MediaTrackConstraints[] = [];
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: {
      getUserMedia: (c: MediaStreamConstraints) => {
        calls.push(c.video as MediaTrackConstraints);
        return impl(c);
      },
    },
    configurable: true,
  });
  return calls;
}

function overconstrained() {
  const e = new Error("no such camera");
  e.name = "OverconstrainedError";
  return e;
}

afterEach(() => {
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: realMedia,
    configurable: true,
  });
});

describe("openCamera", () => {
  test("asks for the exact lens first", async () => {
    const calls = stubGetUserMedia(async () => ({}) as MediaStream);
    await openCamera("environment", { width: { ideal: 1280 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].facingMode).toEqual({ exact: "environment" });
    expect(calls[0].width).toEqual({ ideal: 1280 });
  });

  test("falls back to a loose request on single-camera devices", async () => {
    const calls = stubGetUserMedia(async (c) => {
      const video = c.video as MediaTrackConstraints;
      if (typeof video.facingMode === "object") throw overconstrained();
      return {} as MediaStream;
    });
    await openCamera("user", { width: { ideal: 640 } });
    expect(calls).toHaveLength(2);
    expect(calls[1].facingMode).toBe("user");
  });

  test("does not retry a denied permission", async () => {
    const denied = new Error("denied");
    denied.name = "NotAllowedError";
    const calls = stubGetUserMedia(async () => {
      throw denied;
    });
    expect(openCamera("user", {})).rejects.toThrow("denied");
    expect(calls).toHaveLength(1);
  });
});
