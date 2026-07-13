import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Camera,
  X as XIcon,
  Loader2,
  Sun,
  Lightbulb,
  Shirt,
  FlaskConical,
  ChevronDown,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  analyzePersonalColor as analyzeStudioColor,
  type StudioColorProfile,
} from "@/lib/analyzePersonalColor.functions";
import {
  type StudioTelemetry,
  MANUAL_SEASON_GROUPS,
  SEASON_HEX_MATRIX,
  SEASONS_MASTER_DATA,
} from "@/constants/style-profile";

const DRAPE_COLORS = ["#FFB347", "#94A3B8", "#1E3A8A", "#F7B7A3", "#C2410C"] as const;
const DRAPE_LABELS = [
  "READING YOUR TRUE TONES…",
  "FEELING THE WARMTH IN YOUR SKIN…",
  "STUDYING THE CONTRAST IN YOUR FEATURES…",
] as const;

export function BriefingRule({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex size-9 shrink-0 items-center justify-center border-[0.5px] border-white/30 text-white/90">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.32em] text-white">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-white/65">{body}</p>
      </div>
    </li>
  );
}

export function VisualDiagnosticViewfinder({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: (p: StudioColorProfile, t?: StudioTelemetry) => Promise<void> | void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [drapeIdx, setDrapeIdx] = useState(0);
  const [labelIdx, setLabelIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [calibrated, setCalibrated] = useState(false);
  const [lightingConfirmed, setLightingConfirmed] = useState(false);
  const [telemetryOpen, setTelemetryOpen] = useState(true);
  const [pipelineLog, setPipelineLog] = useState<string[]>(["Waiting for the right light…"]);
  const [manualCalibrateOpen, setManualCalibrateOpen] = useState(false);
  const analyze = useServerFn(analyzeStudioColor);

  function pushLog(line: string) {
    setPipelineLog((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString([], { hour12: false })}] ${line}`,
    ]);
  }

  function stopCamera() {
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {}
      videoRef.current.srcObject = null;
    }
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
    }
    streamRef.current = null;
  }

  useEffect(() => {
    if (!calibrated) return;
    let cancelled = false;
    setStreamErr(null);
    pushLog("Opening the camera…");
    if (!navigator?.mediaDevices?.getUserMedia) {
      setStreamErr(
        "Camera Access Restricted. Please verify your browser site settings allow lens access and ensure you are using an HTTPS connection.",
      );
      pushLog("Camera isn't available on this device.");
      return;
    }
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        pushLog("Camera is on. Let's see you.");
      } catch (e: any) {
        const name = e?.name || "";
        if (
          name === "NotAllowedError" ||
          name === "SecurityError" ||
          name === "PermissionDeniedError"
        ) {
          setStreamErr(
            "Camera Access Restricted. Please verify your browser site settings allow lens access and ensure you are using an HTTPS connection.",
          );
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setStreamErr("No compatible camera was detected on this device.");
        } else {
          setStreamErr(e?.message || "Camera unavailable. Please grant permission.");
        }
        pushLog(`Couldn't open the camera (${name || "unknown"}).`);
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [calibrated]);

  useEffect(() => {
    if (!analyzing) return;
    const c = setInterval(() => setDrapeIdx((i) => (i + 1) % DRAPE_COLORS.length), 350);
    const l = setInterval(() => setLabelIdx((i) => (i + 1) % DRAPE_LABELS.length), 1400);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(c);
      clearInterval(l);
      clearInterval(t);
    };
  }, [analyzing]);

  async function capture(opts?: { stressTest?: boolean }) {
    setAnalyzing(true);
    setDrapeIdx(0);
    setLabelIdx(0);
    setElapsed(0);
    const video = videoRef.current;
    if (!video || video.readyState !== 4 || !video.videoWidth || !video.videoHeight) {
      toast.error("Camera is still warming up. Hold steady for a moment and try again.");
      setAnalyzing(false);
      return;
    }
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      toast.error("Unable to capture frame.");
      setAnalyzing(false);
      return;
    }
    ctx.clearRect(0, 0, 400, 400);
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, 400, 400);
    const base64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
    if (!base64 || base64.length < 1024) {
      toast.error("Captured frame was empty. Please try again.");
      setAnalyzing(false);
      return;
    }
    pushLog(`Captured. Looking at your photo now…`);
    await runAnalyze(base64, opts);
  }

  async function runAnalyze(
    base64: string,
    opts?: { stressTest?: boolean; source?: "live" | "stress-test" | "upload" },
  ) {
    try {
      pushLog(`Studying the light in your photo…`);
      const result = await analyze({
        data: {
          imageBase64: base64,
          diagnostics: opts?.stressTest
            ? {
                forceCalibration: {
                  ambientLighting: "backlit",
                  biologicalUndertone: "cool_blue",
                  computedContrast: "high",
                },
              }
            : undefined,
        },
      });
      if (!result.success) {
        console.error("Studio error details:", result);
        toast.error(
          result.error ||
            "Let's try that again. Make sure the lighting is clear so I can catch the right tones.",
        );
        pushLog(`Something went wrong: ${result.error ?? "unknown"}.`);
        setAnalyzing(false);
        return;
      }
      const profile = result.profile;
      const telemetry: StudioTelemetry = {
        ...result.telemetry,
        source: opts?.stressTest ? "stress-test" : opts?.source === "upload" ? "live" : "live",
      };
      pushLog(`Got it — you're a ${profile.subSeason}.`);
      stopCamera();
      await onComplete(profile, telemetry);
    } catch (e: any) {
      console.error("Studio error details:", e);
      toast.error(
        e?.message ||
          "Let's try that again. Make sure the lighting is clear so I can catch the right tones.",
      );
      pushLog(`Something went wrong: ${e?.message || "unknown"}.`);
      setAnalyzing(false);
    }
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file from your studio archive.");
      return;
    }
    setAnalyzing(true);
    setDrapeIdx(0);
    setLabelIdx(0);
    setElapsed(0);
    pushLog(`Looking at ${file.name}…`);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.split(",")[1];
      if (!base64 || base64.length < 1024) {
        toast.error("That archive image could not be decoded. Try another file.");
        setAnalyzing(false);
        return;
      }
      await runAnalyze(base64, { source: "upload" });
    };
    reader.onerror = () => {
      toast.error("Failed to read archive image.");
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  }

  async function applyManualCalibration(key: keyof typeof SEASONS_MASTER_DATA, label: string) {
    const spec = SEASONS_MASTER_DATA[key];
    const profile: StudioColorProfile = {
      ...spec,
      faceShape: "Oval Frame",
      bodyType: "Hourglass",
      stylistNote: `Chosen by hand · ${label}. Every swatch, beauty note, and color to avoid below is drawn straight from the atelier's ${spec.subSeason} library.`,
      fullPalette: SEASON_HEX_MATRIX[key],
      detectedLighting: "Manual Studio Calibration",
      calculatedUndertone: spec.toneType,
      confidenceScore: 100,
    };
    setManualCalibrateOpen(false);
    stopCamera();
    await onComplete(profile, {
      pass1Raw: { ambientLighting: "n/a", biologicalUndertone: "n/a", computedContrast: "n/a" },
      interceptTriggered: false,
      gatekeeperNotes: [`Chosen by hand · ${label}.`],
      pass2OverrideInputs: {
        ambientLighting: "manual",
        biologicalUndertone: "manual",
        computedContrast: "manual",
        sensorClippingEvent: false,
      },
      forcedDiagnostic: false,
      source: "manual",
    });
  }

  return !calibrated ? (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b-[0.5px] border-border">
        <span className="text-[10px] uppercase tracking-[0.3em] text-accent">
          Seoul Atelier · Find your light
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <XIcon className="size-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-lg border-[0.5px] border-border bg-card text-card-foreground px-7 py-9">
          <p className="text-[9px] uppercase tracking-[0.42em] text-accent text-center">
            Let's find your light
          </p>
          <h3 className="mt-3 font-serif text-3xl tracking-tight text-center text-foreground">
            Step into natural, indirect daylight
          </h3>
          <div className="my-6 h-px w-12 mx-auto bg-foreground/30" />
          <p className="text-xs text-muted-foreground leading-relaxed text-center">
            Before I open the camera, find a window with soft, indirect daylight — no direct sun, no
            overhead yellow bulbs. That's how I see your true tones.
          </p>
          <ul className="mt-7 space-y-5">
            <BriefingRule
              icon={<Sun className="size-4" />}
              title="Face the window"
              body="Natural daylight from the front. No backlight, no direct sun."
            />
            <BriefingRule
              icon={<Lightbulb className="size-4" />}
              title="Switch off yellow bulbs"
              body="Warm overhead lamps throw the read off."
            />
            <BriefingRule
              icon={<Shirt className="size-4" />}
              title="Wear something neutral"
              body="Saturated tops can cast color onto your skin."
            />
          </ul>
          <label className="mt-8 flex items-start gap-3 border-[0.5px] border-border p-4 cursor-pointer hover:border-foreground/40 transition-colors">
            <input
              type="checkbox"
              checked={lightingConfirmed}
              onChange={(e) => setLightingConfirmed(e.target.checked)}
              className="mt-0.5 accent-foreground"
            />
            <span className="text-xs text-muted-foreground leading-relaxed">
              I'm in soft, indirect natural daylight. Let's go.
            </span>
          </label>
          <button
            type="button"
            disabled={!lightingConfirmed}
            onClick={() => {
              pushLog("Light is good. Let's go.");
              setCalibrated(true);
            }}
            className="mt-6 w-full h-11 bg-foreground text-background text-[10px] uppercase tracking-[0.32em] hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Open the camera
          </button>
          <p className="mt-4 text-center text-[9px] uppercase tracking-[0.32em] text-accent">
            Your camera stays off until you're ready.
          </p>
        </div>
      </div>
    </div>
  ) : (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-5 py-4 bg-linear-to-b from-black/70 to-transparent">
        <span className="text-[10px] uppercase tracking-[0.3em] text-white/90">
          Seoul Atelier · Studio Camera
        </span>
        <button onClick={onClose} className="text-white/80 hover:text-white">
          <XIcon className="size-5" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
        <canvas ref={canvasRef} className="hidden" />

        <svg
          className="absolute inset-0 h-full w-full pointer-events-none"
          viewBox="0 0 100 140"
          preserveAspectRatio="xMidYMid meet"
        >
          <ellipse
            cx="50"
            cy="62"
            rx="22"
            ry="34"
            fill="none"
            stroke="#D4A24C"
            strokeWidth="0.35"
            strokeDasharray="1 1.2"
            opacity="0.9"
          />
          <ellipse
            cx="50"
            cy="62"
            rx="22.4"
            ry="34.4"
            fill="none"
            stroke="#D4A24C"
            strokeWidth="0.08"
            opacity="0.5"
          />
        </svg>

        <svg
          className="absolute inset-0 h-full w-full pointer-events-none"
          viewBox="0 0 100 140"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="drapeCape" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9CA3AF" stopOpacity="0" />
              <stop offset="35%" stopColor="#6B7280" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#3F3F46" stopOpacity="0.42" />
            </linearGradient>
          </defs>
          <path
            d="M0,112 Q22,96 36,108 Q50,124 64,108 Q78,96 100,112 L100,140 L0,140 Z"
            fill="url(#drapeCape)"
          />
          <path
            d="M0,112 Q22,96 36,108 Q50,124 64,108 Q78,96 100,112"
            fill="none"
            stroke="#E5E7EB"
            strokeOpacity="0.35"
            strokeWidth="0.25"
          />
        </svg>

        <div className="absolute top-16 right-4 z-30 w-70 max-w-[78vw] hidden sm:block">
          <div className="border-[0.5px] border-white/20 bg-black/55 backdrop-blur-md text-white">
            <button
              type="button"
              onClick={() => setTelemetryOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-[9px] uppercase tracking-[0.32em] hover:bg-white/5"
              aria-expanded={telemetryOpen}
            >
              <span className="inline-flex items-center gap-1.5">
                <FlaskConical className="size-3" /> Studio notes
              </span>
              <ChevronDown
                className={`size-3 transition-transform ${telemetryOpen ? "rotate-180" : ""}`}
              />
            </button>
            {telemetryOpen && (
              <pre className="max-h-64 overflow-y-auto px-3 pb-3 pt-0 font-mono text-[9px] leading-relaxed text-white/75 whitespace-pre-wrap wrap-break-word">
                {pipelineLog.length ? pipelineLog.join("\n") : "Waiting…"}
              </pre>
            )}
          </div>
        </div>

        {streamErr && !analyzing && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 text-center px-8 bg-black/85 text-white">
            <Camera className="size-6" />
            <p className="text-xs leading-relaxed max-w-xs">{streamErr}</p>
          </div>
        )}

        {analyzing && (
          <div
            className="absolute inset-0 z-40 flex flex-col items-center justify-center transition-colors duration-300"
            style={{ backgroundColor: DRAPE_COLORS[drapeIdx] }}
          >
            <div className="text-center px-8 mix-blend-difference">
              <p className="text-[10px] uppercase tracking-[0.35em] text-white font-medium">
                {DRAPE_LABELS[labelIdx]}
              </p>
              <div className="mt-6 h-px w-20 mx-auto bg-white/80" />
              <p className="mt-6 text-[9px] uppercase tracking-[0.4em] text-white/90">
                Seoul Studio · Reading your tones
              </p>
              <p className="mt-4 font-serif text-3xl tabular-nums text-white tracking-[0.2em]">
                {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
                {String(elapsed % 60).padStart(2, "0")}
              </p>
              <p className="mt-1 text-[9px] uppercase tracking-[0.4em] text-white/80">
                Looking at your photo
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-24 inset-x-0 z-20 flex items-center justify-center">
        <button
          onClick={() => capture()}
          disabled={analyzing || !!streamErr}
          className="group relative flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 hover:scale-105 active:scale-95"
          aria-label="Take photo"
        >
          <span className="absolute inset-0 rounded-full border-2 border-white/80 bg-black/10 backdrop-blur-sm" />
          <span className="relative flex items-center justify-center size-14 rounded-full bg-white/90 shadow-sm">
            {analyzing ? <Loader2 className="size-5 animate-spin text-black/80" /> : null}
          </span>
        </button>
        <button
          type="button"
          onClick={() => capture({ stressTest: true })}
          disabled={analyzing || !!streamErr}
          className="absolute right-6 inline-flex items-center justify-center size-8 rounded-full border border-white/30 bg-black/40 text-white/70 hover:text-white hover:border-white/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Try a tricky-light sample"
          title="Sample look · backlit, high contrast"
        >
          <FlaskConical className="size-3.5" />
        </button>
      </div>

      {!analyzing && (
        <div className="absolute bottom-44 inset-x-0 z-10 flex justify-center pointer-events-none">
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/70 font-serif italic">
            Align your profile boundaries within the guide
          </p>
        </div>
      )}

      {!analyzing && (
        <div className="absolute bottom-6 inset-x-0 z-20 flex flex-col items-center gap-2 px-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-[10px] uppercase tracking-[0.32em] text-white/70 hover:text-white transition-colors border-b border-white/20 hover:border-white/60 pb-1"
          >
            Upload a photo instead
          </button>
          <button
            type="button"
            onClick={() => setManualCalibrateOpen(true)}
            className="text-[9px] uppercase tracking-[0.32em] text-white/50 hover:text-white/80 transition-colors"
          >
            Already know your seasonal palette? Choose your look
          </button>
        </div>
      )}

      <Sheet open={manualCalibrateOpen} onOpenChange={setManualCalibrateOpen}>
        <SheetContent
          side="bottom"
          className="bg-[#0B0B0B] text-white border-t border-white/10 rounded-t-2xl max-h-[85vh] overflow-y-auto"
        >
          <SheetHeader className="text-left">
            <p className="text-[9px] uppercase tracking-[0.42em] text-white/50">Seoul Atelier</p>
            <SheetTitle className="font-serif text-2xl tracking-tight text-white">
              Already know your seasonal palette? Choose your look below.
            </SheetTitle>
            <SheetDescription className="text-[11px] text-white/60 leading-relaxed">
              Skip the camera and pick your sub-season — your palette, beauty notes, and colors to
              avoid load straight from the atelier library.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-7 pb-6">
            {MANUAL_SEASON_GROUPS.map((group) => (
              <div key={group.season}>
                <div className="flex items-center gap-3">
                  <span className="h-px w-6 bg-white/30" />
                  <p className="text-[10px] uppercase tracking-[0.38em] text-white/70">
                    {group.season}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {group.keys.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => void applyManualCalibration(k.key, k.label)}
                      className="group text-left border border-white/15 hover:border-white/60 bg-white/2 hover:bg-white/6 px-4 py-3 transition-colors"
                    >
                      <p className="text-[11px] uppercase tracking-[0.22em] text-white">
                        {k.label}
                      </p>
                      <p className="mt-1 text-[10px] text-white/55 leading-relaxed line-clamp-2">
                        {SEASONS_MASTER_DATA[k.key].subSeason}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
