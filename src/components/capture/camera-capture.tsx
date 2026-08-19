import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, SwitchCamera, X, ImageIcon } from "lucide-react";
import { errorMessage } from "@/lib/utils";
import { captureVideoFrame, openCamera } from "@/lib/capture-frame";

interface Props {
  onCapture: (file: File) => void;
  onPickGallery: () => void;
  disabled?: boolean;
  analyzing?: boolean;
  frozenPreview?: string | null;
  /** "user" for anything aimed at the member's own face. */
  facingMode?: "user" | "environment";
  copy?: { idle?: string; hint?: string; frame?: string };
}

export function CameraCapture({
  onCapture,
  onPickGallery,
  disabled,
  analyzing,
  frozenPreview,
  facingMode = "environment",
  copy,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState(facingMode);

  useEffect(() => () => stopStream(), []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function start(next: "user" | "environment" = facing) {
    if (disabled) return;
    setError(null);
    setStarting(true);
    stopStream(); // release the current lens first — iOS won't hand over the other one otherwise
    try {
      const stream = await openCamera(next, { width: { ideal: 1280 }, height: { ideal: 1280 } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setFacing(next);
      setActive(true);
    } catch (e) {
      setActive(false); // drop back to the idle card — it's the only view that shows the error
      setError(errorMessage(e, "Camera unavailable. Allow camera permissions or use gallery."));
    } finally {
      setStarting(false);
    }
  }

  function close() {
    stopStream();
    setActive(false);
  }

  async function snap() {
    const file = await captureVideoFrame(videoRef.current, `capture-${Date.now()}.jpg`);
    if (!file) return;
    stopStream();
    setActive(false);
    onCapture(file);
  }

  if (frozenPreview) {
    return (
      <div className="relative aspect-4/3 overflow-hidden rounded-2xl border border-white/15 bg-black">
        <img
          src={frozenPreview}
          alt="captured outfit"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {analyzing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 backdrop-blur-sm text-white">
            <Loader2 className="size-8 animate-spin mb-3" />
            <p className="font-serif text-xl">Analyzing outfit silhouettes and tones…</p>
          </div>
        )}
      </div>
    );
  }

  if (!active) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => start()}
          disabled={disabled || starting}
          className={`group relative w-full aspect-video sm:aspect-4/3 rounded-2xl overflow-hidden border border-border bg-canvas transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-foreground/40 cursor-pointer"}`}
        >
          <div className="relative h-full w-full flex flex-col items-center justify-center text-center px-6 sm:px-8">
            <div className="size-14 sm:size-16 rounded-full border border-border bg-background/60 flex items-center justify-center mb-4 sm:mb-5 group-hover:scale-105 transition-transform">
              {starting ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <Camera className="size-6" strokeWidth={1.25} />
              )}
            </div>
            <p className="font-serif text-xl sm:text-2xl md:text-3xl mb-1.5 sm:mb-2">
              {disabled ? "Complete your profile first" : (copy?.idle ?? "Open camera & scan")}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {disabled
                ? "Set body type & color season above to unlock the scanner."
                : (copy?.hint ?? "Capture your outfit in real time for instant stylist analysis.")}
            </p>
            {error && <p className="mt-4 text-xs text-destructive max-w-sm">{error}</p>}
          </div>
        </button>

        <div className="text-center">
          <button
            type="button"
            onClick={onPickGallery}
            disabled={disabled}
            className="inline-flex items-center gap-2 text-xs uppercase tracking-label-wide text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ImageIcon className="size-3.5" />
            Or choose a photo from gallery
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl border border-white/15 bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className={`absolute inset-0 w-full h-full object-cover ${facing === "user" ? "scale-x-[-1]" : ""}`}
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[70%] h-[85%] rounded-xl border-2 border-dashed border-white/70" />
      </div>

      <div className="pointer-events-none absolute top-8 left-4 right-4 flex justify-center">
        <span className="text-micro uppercase tracking-label-wide text-white/80 bg-black/40 backdrop-blur px-3 py-1 rounded-full">
          {copy?.frame ?? "Align outfit inside the frame"}
        </span>
      </div>

      <button
        type="button"
        onClick={close}
        className="absolute top-3 right-3 size-9 rounded-full bg-black/50 backdrop-blur text-white flex items-center justify-center hover:bg-black/70"
        aria-label="Close camera"
      >
        <X className="size-4" />
      </button>

      <div className="absolute inset-x-0 bottom-0 px-5 pb-5 pt-14 bg-linear-to-t from-black/80 via-black/45 to-transparent">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center pb-10">
          <button
            type="button"
            onClick={() => start(facing === "user" ? "environment" : "user")}
            disabled={starting}
            className="justify-self-end mr-5 h-11 w-11 rounded-full bg-black/45 backdrop-blur text-white flex items-center justify-center hover:bg-black/65 transition-colors disabled:opacity-50"
            aria-label={facing === "user" ? "Switch to rear camera" : "Switch to front camera"}
          >
            <SwitchCamera className="size-4" />
          </button>

          <button
            type="button"
            onClick={snap}
            className="size-16 mx-3 rounded-full bg-white ring-[6px] ring-white/25 shadow-lg shadow-black/30 hover:ring-white/40 transition-shadow"
            aria-label="Capture photo"
          />

          <button
            type="button"
            onClick={onPickGallery}
            className="justify-self-start ml-5 h-11 rounded-full bg-black/45 backdrop-blur px-4 text-white flex items-center gap-2 hover:bg-black/65 transition-colors"
            aria-label="Choose from gallery"
          >
            <ImageIcon className="size-4" />
            <span className="text-micro uppercase tracking-label-wide">Gallery</span>
          </button>
        </div>
      </div>
    </div>
  );
}
