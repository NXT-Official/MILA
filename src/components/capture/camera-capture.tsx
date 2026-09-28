import { useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Loader2, RotateCcw, X, ImageIcon, Zap, ZapOff } from "lucide-react";
import { captureVideoFrame } from "@/lib/capture-frame";
import { useCameraStream } from "@/hooks/use-camera-stream";

interface Props {
  onCapture: (file: File) => void;
  onPickGallery: () => void;
  disabled?: boolean;
  analyzing?: boolean;
  frozenPreview?: string | null;
  /** "user" = front/selfie camera, "environment" = back camera (default). */
  facingMode?: "user" | "environment";
  title?: string;
  subtitle?: string;
}

export function CameraCapture({
  onCapture,
  onPickGallery,
  disabled,
  analyzing,
  frozenPreview,
  facingMode = "environment",
  title = "Open Camera & Scan",
  subtitle = "Capture your outfit in real time for instant stylist analysis.",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { active, starting, error, torchOn, torchSupported, start, stop, toggleTorch } =
    useCameraStream(videoRef);

  function open() {
    if (disabled) return;
    void start({
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 1280 },
    });
  }

  async function snap() {
    const file = await captureVideoFrame(videoRef.current, `capture-${Date.now()}.jpg`);
    if (!file) return;
    stop();
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

  return (
    <>
      {!active && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={open}
            disabled={disabled || starting}
            className={`group relative w-full aspect-4/3 rounded-2xl overflow-hidden border border-dashed border-white/25 bg-linear-to-br from-foreground/4 via-accent/5 to-foreground/2 backdrop-blur-xl transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-foreground/60 cursor-pointer"}`}
          >
            <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-foreground/10 blur-3xl" />
            <div className="relative h-full w-full flex flex-col items-center justify-center text-center px-8">
              <div className="size-16 rounded-full border border-white/25 bg-background/40 backdrop-blur flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                {starting ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : (
                  <Camera className="size-6" strokeWidth={1.25} />
                )}
              </div>
              <p className="font-serif text-2xl md:text-3xl mb-2">
                {disabled ? "Complete your profile first" : title}
              </p>
              <p className="text-sm text-muted-foreground max-w-sm">
                {disabled ? "Set body type & color season above to unlock the scanner." : subtitle}
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
      )}

      {/* Fullscreen takeover while the camera is active — the video feed is
          the entire point of this moment, so it gets the whole viewport
          instead of staying boxed in the page's normal layout. */}
      <AnimatePresence>
        {active && (
          <motion.div
            className="fixed inset-0 z-50 bg-black"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />

            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-[70%] h-[85%] rounded-xl border-2 border-dashed border-white/70" />
            </div>

            <div className="pointer-events-none absolute top-8 left-4 right-4 flex justify-center">
              <span className="text-micro uppercase tracking-label-wide text-white/80 bg-black/40 backdrop-blur px-3 py-1 rounded-full">
                Align outfit inside the frame
              </span>
            </div>

            <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
              {torchSupported ? (
                <button
                  type="button"
                  onClick={() => void toggleTorch()}
                  className={`size-9 rounded-full backdrop-blur text-white flex items-center justify-center transition-colors ${torchOn ? "bg-white/90 text-black" : "bg-black/50 hover:bg-black/70"}`}
                  aria-label={torchOn ? "Turn off flash" : "Turn on flash"}
                  aria-pressed={torchOn}
                >
                  {torchOn ? <Zap className="size-4" /> : <ZapOff className="size-4" />}
                </button>
              ) : (
                <span />
              )}

              <button
                type="button"
                onClick={stop}
                className="size-9 rounded-full bg-black/50 backdrop-blur text-white flex items-center justify-center hover:bg-black/70"
                aria-label="Close camera"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="absolute inset-x-0 bottom-0 px-5 pb-5 pt-14 bg-linear-to-t from-black/80 via-black/45 to-transparent">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center pb-10">
                <button
                  type="button"
                  onClick={open}
                  className="justify-self-end mr-5 h-11 w-11 rounded-full bg-black/45 backdrop-blur text-white flex items-center justify-center hover:bg-black/65 transition-colors"
                  aria-label="Restart camera"
                >
                  <RotateCcw className="size-4" />
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
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
