import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw, X, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onCapture: (file: File) => void;
  onPickGallery: () => void;
  disabled?: boolean;
  analyzing?: boolean;
  frozenPreview?: string | null;
}

export function CameraCapture({ onCapture, onPickGallery, disabled, analyzing, frozenPreview }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => stopStream(), []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function start() {
    if (disabled) return;
    setError(null);
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Camera unavailable. Allow camera permissions or use gallery.");
    } finally {
      setStarting(false);
    }
  }

  function close() {
    stopStream();
    setActive(false);
  }

  function snap() {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
      stopStream();
      setActive(false);
      onCapture(file);
    }, "image/jpeg", 0.92);
  }

  // Frozen preview + analyzing overlay
  if (frozenPreview) {
    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/15 bg-black">
        <img src={frozenPreview} alt="captured outfit" className="absolute inset-0 w-full h-full object-cover" />
        {analyzing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 backdrop-blur-sm text-white">
            <Loader2 className="h-8 w-8 animate-spin mb-3" />
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
          onClick={start}
          disabled={disabled || starting}
          className={`group relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-dashed border-white/25 bg-gradient-to-br from-foreground/[0.04] via-accent/[0.05] to-foreground/[0.02] backdrop-blur-xl transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-foreground/60 cursor-pointer"}`}
        >
          <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-foreground/10 blur-3xl" />
          <div className="relative h-full w-full flex flex-col items-center justify-center text-center px-8">
            <div className="h-16 w-16 rounded-full border border-white/25 bg-background/40 backdrop-blur flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
              {starting ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" strokeWidth={1.25} />}
            </div>
            <p className="font-serif text-2xl md:text-3xl mb-2">
              {disabled ? "Complete your profile first" : "Open Camera & Scan"}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {disabled
                ? "Set body type & color season above to unlock the scanner."
                : "Capture your outfit in real time for instant stylist analysis."}
            </p>
            {error && <p className="mt-4 text-xs text-destructive max-w-sm">{error}</p>}
          </div>
        </button>

        <div className="text-center">
          <button
            type="button"
            onClick={onPickGallery}
            disabled={disabled}
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Or choose a photo from gallery
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/15 bg-black">
      <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
      {/* Alignment overlay */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[70%] h-[85%] rounded-xl border-2 border-dashed border-white/70" />
      </div>
      <div className="pointer-events-none absolute top-4 left-4 right-4 flex justify-between">
        <span className="text-[10px] uppercase tracking-[0.25em] text-white/80 bg-black/40 backdrop-blur px-3 py-1 rounded-full">
          Align outfit inside the frame
        </span>
      </div>
      <button
        type="button"
        onClick={close}
        className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/50 backdrop-blur text-white flex items-center justify-center hover:bg-black/70"
        aria-label="Close camera"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-6 p-6 bg-gradient-to-t from-black/70 to-transparent">
        <button
          type="button"
          onClick={start}
          className="h-10 w-10 rounded-full bg-black/40 backdrop-blur text-white flex items-center justify-center hover:bg-black/60"
          aria-label="Restart camera"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={snap}
          className="h-16 w-16 rounded-full bg-white ring-4 ring-white/30 hover:ring-white/50 transition-shadow"
          aria-label="Capture photo"
        />
        <Button
          type="button"
          variant="ghost"
          onClick={onPickGallery}
          className="h-10 rounded-full text-white hover:bg-white/10 text-[11px] uppercase tracking-[0.22em]"
        >
          <ImageIcon className="h-4 w-4 mr-2" /> Gallery
        </Button>
      </div>
    </div>
  );
}