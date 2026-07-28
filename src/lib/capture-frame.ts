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
