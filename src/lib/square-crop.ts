export type SquareCrop = { sx: number; sy: number; size: number };

/**
 * The largest square that fits in a `width` x `height` frame, centred, as a
 * source rect for `drawImage`. Drawing the whole frame into a square canvas
 * instead stretches it (a 16:9 camera frame squeezes a face to 56% width);
 * cropping first keeps the face's proportions. Offsets round down so the rect
 * stays on whole pixels. A frame with no usable size yields an empty crop.
 */
export function centeredSquareCrop(width: number, height: number): SquareCrop {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { sx: 0, sy: 0, size: 0 };
  }
  const size = Math.min(width, height);
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
  };
}
