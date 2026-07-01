import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Step = "back" | "front" | "review";

interface DualCaptureProps {
  onSubmit: (back: File, front: File, caption: string) => Promise<void> | void;
  onCancel?: () => void;
  submitting?: boolean;
}

const STEP_COPY: Record<Exclude<Step, "review">, { eyebrow: string; title: string; hint: string; facing: "environment" | "user" }> = {
  back: {
    eyebrow: "Step 1 / 2 — The Fit",
    title: "Mirror selfie, full body",
    hint: "Use the rear camera. Step back, frame head to toe.",
    facing: "environment",
  },
  front: {
    eyebrow: "Step 2 / 2 — The Face & Hair",
    title: "Front camera portrait",
    hint: "Bring the lens to your face — let your hair and makeup carry the moment.",
    facing: "user",
  },
};

export function DualCapture({ onSubmit, onCancel, submitting = false }: DualCaptureProps) {
  const [step, setStep] = useState<Step>("back");
  const [back, setBack] = useState<File | null>(null);
  const [front, setFront] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(() => stopStream, []);

  async function startCamera(facing: "environment" | "user") {
    setError(null);
    setStarting(true);
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1440 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Camera unavailable. Allow camera access.");
    } finally {
      setStarting(false);
    }
  }

  function snap(label: Step) {
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
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `${label}-${Date.now()}.jpg`, { type: "image/jpeg" });
        stopStream();
        setActive(false);
        if (label === "back") {
          setBack(file);
          setStep("front");
        } else {
          setFront(file);
          setStep("review");
        }
      },
      "image/jpeg",
      0.92,
    );
  }

  function retake(target: Step) {
    if (target === "back") {
      setBack(null);
      setStep("back");
    } else if (target === "front") {
      setFront(null);
      setStep("front");
    }
    setActive(false);
    stopStream();
  }

  // Review step
  if (step === "review" && back && front) {
    return (
      <div className="space-y-5">
        <div className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden border border-porcelain/60 bg-atelier-ivory/60 shadow-atelier-soft">
          <img src={URL.createObjectURL(back)} alt="The fit" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute top-4 left-4 h-20 w-20 rounded-full overflow-hidden border-2 border-atelier-ivory shadow-atelier-float">
            <img src={URL.createObjectURL(front)} alt="Face & hair" className="h-full w-full object-cover" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => retake("back")}
            disabled={submitting}
            className="h-10 rounded-full border border-porcelain/60 text-[10px] uppercase tracking-[0.22em] text-stone hover:text-ink hover:border-porcelain transition-colors disabled:opacity-50"
          >
            Retake the fit
          </button>
          <button
            type="button"
            onClick={() => retake("front")}
            disabled={submitting}
            className="h-10 rounded-full border border-porcelain/60 text-[10px] uppercase tracking-[0.22em] text-stone hover:text-ink hover:border-porcelain transition-colors disabled:opacity-50"
          >
            Retake portrait
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-[0.28em] text-stone">Caption (optional)</label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="A line about today's mood, the weather, the muse…"
            className="w-full rounded-2xl border border-porcelain/60 bg-background/70 backdrop-blur p-4 text-sm text-ink placeholder:text-stone focus:outline-none focus:ring-1 focus:ring-atelier-champagne"
          />
        </div>

        <div className="flex items-center gap-3">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={submitting}
              className="text-[10px] uppercase tracking-[0.22em] text-stone"
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            onClick={() => onSubmit(back, front, caption.trim())}
            disabled={submitting}
            className="flex-1 h-12 rounded-full bg-ink text-atelier-ivory hover:bg-ink/90 text-[10px] uppercase tracking-[0.32em]"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Posting…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4" /> Post Today's OOTD
              </span>
            )}
          </Button>
        </div>
      </div>
    );
  }

  const copy = STEP_COPY[step as "back" | "front"];

  return (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{copy.eyebrow}</p>
        <p className="font-serif text-2xl text-ink">{copy.title}</p>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">{copy.hint}</p>
      </div>

      {!active ? (
        <button
          type="button"
          onClick={() => startCamera(copy.facing)}
          disabled={starting}
          className={cn(
            "group relative w-full aspect-[3/4] rounded-2xl overflow-hidden border border-dashed border-porcelain/70 bg-atelier-ivory/40 backdrop-blur-xl transition-colors hover:border-ink/30",
            starting && "opacity-60 cursor-wait",
          )}
        >
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
            <div className="h-16 w-16 rounded-full border border-porcelain/70 bg-background/60 backdrop-blur flex items-center justify-center mb-5">
              {starting ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" strokeWidth={1.25} />}
            </div>
            <p className="font-serif text-xl mb-1">
              {step === "back" ? "Open rear camera" : "Switch to front camera"}
            </p>
            <p className="text-xs text-muted-foreground">Tap to begin capture</p>
            {error && <p className="mt-4 text-xs text-destructive max-w-sm">{error}</p>}
          </div>
        </button>
      ) : (
        <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-porcelain/60 bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className={cn(
              "absolute inset-0 w-full h-full object-cover",
              copy.facing === "user" && "scale-x-[-1]",
            )}
          />
          <button
            type="button"
            onClick={() => { stopStream(); setActive(false); }}
            className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/50 backdrop-blur text-white flex items-center justify-center hover:bg-black/70"
            aria-label="Close camera"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-6 p-6 bg-gradient-to-t from-black/70 to-transparent">
            <button
              type="button"
              onClick={() => startCamera(copy.facing)}
              className="h-10 w-10 rounded-full bg-black/40 backdrop-blur text-white flex items-center justify-center hover:bg-black/60"
              aria-label="Restart camera"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => snap(step)}
              className="h-16 w-16 rounded-full bg-white ring-4 ring-white/30 hover:ring-white/50 transition-shadow"
              aria-label="Capture"
            />
            <span className="w-10" />
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-1.5 pt-1">
        <span className={cn("h-1.5 w-6 rounded-full transition-colors", back ? "bg-ink" : "bg-porcelain")} />
        <span className={cn("h-1.5 w-6 rounded-full transition-colors", front ? "bg-ink" : "bg-porcelain")} />
      </div>
    </div>
  );
}