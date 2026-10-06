import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/utils";

/** The `torch` capability is a real, shipping MediaStream extension (Chrome/
 * Android WebView) that lib.dom.d.ts doesn't type yet — narrow, local
 * extensions instead of reaching for `any`. */
interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}
interface TorchConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
}

/**
 * Shared getUserMedia lifecycle for CameraCapture and DualCapture: start/stop
 * the stream, track loading/error state, and detect + toggle flash (torch)
 * when the active device supports it. Torch support varies by device/browser
 * (most front cameras and desktop webcams don't have one), so `torchSupported`
 * must be checked before showing a flash control at all.
 */
export function useCameraStream(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    stopTracks();
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    setTorchOn(false);
    setTorchSupported(false);
  }, [videoRef, stopTracks]);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (constraints: MediaTrackConstraints) => {
      setError(null);
      setStarting(true);
      // Stop the previous track without resetting `active`/torch state —
      // switching cameras (front/rear) calls start() again on an already-
      // active stream, and dropping `active` to false here would unmount
      // the fullscreen camera view mid-switch, looking like the camera
      // closed instead of flipped.
      stopTracks();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: constraints,
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const [track] = stream.getVideoTracks();
        const capabilities = track?.getCapabilities?.() as TorchCapabilities | undefined;
        setTorchOn(false);
        setTorchSupported(!!capabilities?.torch);
        setActive(true);
      } catch (e) {
        setError(errorMessage(e, "Camera unavailable. Allow camera permissions or use gallery."));
      } finally {
        setStarting(false);
      }
    },
    [videoRef, stopTracks],
  );

  // The capture views mount their <video> only while `active` is true, so on
  // the very first open() the element is not in the tree yet when start()
  // resolves and its srcObject assignment silently misses — the preview then
  // stays black until a camera switch re-runs start() with the element
  // mounted. Attach the stream whenever an active stream and the element
  // coexist.
  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => {});
    }
  }, [active, videoRef]);

  const toggleTorch = useCallback(async () => {
    const [track] = streamRef.current?.getVideoTracks() ?? [];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TorchConstraintSet] });
      setTorchOn(next);
    } catch {
      // Device claimed torch support in getCapabilities but rejected the
      // constraint at apply time — leave torchOn as-is rather than lying
      // about the flash state.
    }
  }, [torchOn]);

  return { streamRef, active, starting, error, torchOn, torchSupported, start, stop, toggleTorch };
}
