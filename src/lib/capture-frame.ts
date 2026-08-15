/**
 * Open a specific lens. `facingMode: { ideal }` is only a hint — browsers happily
 * return the default camera instead, so ask for `exact` first.
 */
export async function openCamera(
  facing: "user" | "environment",
  size: MediaTrackConstraints,
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { ...size, facingMode: { exact: facing } },
      audio: false,
    });
  } catch (e) {
    // ponytail: exact throws on single-camera devices (most laptops). Retry loose so
    // they still get their one camera; swap to enumerateDevices if a device needs
    // picking between multiple rear lenses.
    if (e instanceof Error && e.name !== "OverconstrainedError") throw e;
    return navigator.mediaDevices.getUserMedia({
      video: { ...size, facingMode: facing },
      audio: false,
    });
  }
}

export function captureVideoFrame(
  video: HTMLVideoElement | null,
  filename: string,
): Promise<File | null> {
  if (!video) return Promise.resolve(null);
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return Promise.resolve(null);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, w, h);

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? new File([blob], filename, { type: "image/jpeg" }) : null),
      "image/jpeg",
      0.92,
    );
  });
}
