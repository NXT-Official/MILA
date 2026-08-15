import { useEffect, useRef, useState } from "react";
import { ImageIcon, RotateCcw, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraCapture } from "@/components/capture/camera-capture";
import { cn } from "@/lib/utils";
import {
  MAKEUP_LOOKS,
  MAKEUP_CATEGORIES,
  NAMED_PALETTE,
  type MakeupLook,
  type NamedSwatch,
  type Season,
  type DetailedColorProfile as StudioDossier,
} from "@/constants/style-profile";

type Mode = "makeup" | "colours";

/** Reference buttons are uppercase and letterspaced, not sentence-case body text. */
const CTA = "w-full text-micro uppercase tracking-label-wide";
type Verdict = "Ideal" | "Harmonizing" | "Accent";

const VERDICT_CAPTION: Record<Verdict, string> = {
  Ideal: "Sits closest to your own coloring — wear it near the face without a second thought.",
  Harmonizing: "Works, but reads quieter. Best as the second or third colour in a look.",
  Accent: "One deliberate note — a scarf, a lip, a shoe. Not the whole outfit.",
};

function ModePill({
  active,
  disabled,
  children,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "atelier-focus-ring rounded-pill px-4 py-1.5 text-[0.6875rem] uppercase tracking-label transition-colors",
        disabled
          ? "border border-dashed border-border text-muted-foreground/50"
          : active
            ? "bg-ink text-surface"
            : "border border-border text-muted-foreground hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function ShadeCard({
  hex,
  name,
  active,
  onClick,
}: {
  hex: string;
  name: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "atelier-focus-ring overflow-hidden rounded-control border text-left transition-all",
        active ? "border-accent ring-1 ring-accent/40" : "border-border hover:border-accent/40",
      )}
    >
      <span className="block h-12 w-full" style={{ backgroundColor: hex }} aria-hidden="true" />
      <span className="block px-3 py-2 text-xs text-foreground">{name}</span>
    </button>
  );
}

/**
 * Try looks on yourself. The photo never leaves the browser — it lives as an
 * object URL and dies with it, which is why this is a preview rather than a
 * render: nothing is uploaded, so nothing can be processed server-side.
 */
export function PhotoTryOn({ dossier }: { dossier: StudioDossier }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("makeup");
  const [category, setCategory] = useState<MakeupLook["category"]>("Lips");
  const [look, setLook] = useState<MakeupLook | null>(null);
  const [colour, setColour] = useState<{ swatch: NamedSwatch; verdict: Verdict } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const family = dossier.season as Season;
  const looks = (MAKEUP_LOOKS[family] ?? []).filter((l) => l.category === category);
  const palette = NAMED_PALETTE[family] ?? NAMED_PALETTE.Summer;

  useEffect(() => {
    if (!photoUrl) return;
    return () => URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  function applyPhoto(file: File) {
    setPhotoUrl(URL.createObjectURL(file));
    setCameraOpen(false);
  }

  const overlayHex = mode === "makeup" ? (look?.hex ?? null) : (colour?.swatch.hex ?? null);
  const selectedName = mode === "makeup" ? look?.name : colour?.swatch.name;
  const selectedNote =
    mode === "makeup" ? look?.note : colour ? VERDICT_CAPTION[colour.verdict] : undefined;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-nano uppercase tracking-label-max text-muted-foreground">Try it on</p>
        <h2 className="mt-1.5 font-serif text-3xl leading-tight tracking-tight text-foreground">
          Try looks on yourself
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Upload a clear photo or take a selfie to preview makeup and seasonal colours on your own
          features.
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) applyPhoto(file);
          e.target.value = "";
        }}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {/* PREVIEW */}
        <div className="rounded-card border-[0.5px] border-border bg-card p-4 shadow-paper">
          <div className="relative aspect-3/4 overflow-hidden rounded-control bg-surface/60">
            <div className="absolute inset-x-3 top-3 z-30 flex items-center justify-between gap-2">
              <span className="rounded-pill bg-ink/85 px-3 py-1 text-nano uppercase tracking-label-wide text-surface">
                Preview
              </span>
              <span className="max-w-[55%] truncate rounded-pill bg-ink/85 px-3 py-1 text-nano uppercase tracking-label text-surface">
                {dossier.subSeason}
              </span>
            </div>

            {cameraOpen ? (
              <div className="absolute inset-0">
                <CameraCapture
                  facingMode="user"
                  copy={{
                    idle: "Take a selfie",
                    hint: "Face the light. No makeup filter — Mila needs your real coloring.",
                    frame: "Center your face and shoulders",
                  }}
                  onCapture={applyPhoto}
                  onPickGallery={() => fileRef.current?.click()}
                />
              </div>
            ) : photoUrl ? (
              <>
                <img
                  src={photoUrl}
                  alt="Your photo, for previewing colours against"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {overlayHex && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-10"
                    style={{
                      background: `radial-gradient(120% 80% at 50% 0%, ${overlayHex}00 35%, ${overlayHex} 100%)`,
                      mixBlendMode: "soft-light",
                    }}
                  />
                )}
                {mode === "colours" && overlayHex && (
                  // The drape: solid colour at the collar, where a garment sits.
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[28%]"
                    style={{
                      background: `linear-gradient(to bottom, ${overlayHex}00, ${overlayHex} 45%)`,
                    }}
                  />
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
                <span className="flex size-16 items-center justify-center rounded-full border border-accent/40">
                  <Camera className="size-6 text-accent" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  See your palette on your own features. Upload a clear photo or take a selfie to
                  try makeup and seasonal colours on yourself.
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {photoUrl ? (
              <>
                <Button
                  variant="outline"
                  size="pill"
                  className={CTA}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageIcon aria-hidden="true" /> Choose another photo
                </Button>
                <Button
                  variant="ghost"
                  size="pill"
                  className={CTA}
                  onClick={() => {
                    setPhotoUrl(null);
                    setLook(null);
                    setColour(null);
                  }}
                >
                  <RotateCcw aria-hidden="true" /> Retake
                </Button>
              </>
            ) : (
              <>
                <Button size="pill" className={CTA} onClick={() => setCameraOpen(true)}>
                  <Camera aria-hidden="true" /> Take a selfie
                </Button>
                <Button
                  variant="outline"
                  size="pill"
                  className={CTA}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageIcon aria-hidden="true" /> Upload a photo
                </Button>
              </>
            )}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Your photo stays private and is only used for your personal try-on previews. Nothing is
            uploaded.
          </p>
        </div>

        {/* CONTROLS */}
        <div className="rounded-card border-[0.5px] border-border bg-card p-5 shadow-paper">
          <p className="text-nano uppercase tracking-label-max text-muted-foreground">Try on</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <ModePill active={mode === "makeup"} onClick={() => setMode("makeup")}>
              Makeup
            </ModePill>
            <ModePill active={mode === "colours"} onClick={() => setMode("colours")}>
              Colours
            </ModePill>
            <ModePill disabled>Hair · soon</ModePill>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {photoUrl
              ? "Pick a shade to preview it against your own colouring."
              : "Upload a photo to begin. Try your palette, makeup tones, and styling direction on your own features."}
          </p>

          {mode === "makeup" ? (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {MAKEUP_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={category === c}
                    className={cn(
                      "atelier-focus-ring rounded-pill border px-3 py-1 text-xs uppercase tracking-label transition-colors",
                      category === c
                        ? "border-accent bg-accent-soft/60 text-ink"
                        : "border-border text-muted-foreground hover:text-ink",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {looks.map((l) => (
                  <ShadeCard
                    key={l.id}
                    hex={l.hex}
                    name={l.name}
                    active={look?.id === l.id}
                    onClick={() => setLook(l)}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="mt-4 space-y-4">
              {(
                [
                  ["Best colours", palette.primary, "Ideal"],
                  ["Accents", palette.accents, "Accent"],
                  ["Neutrals", palette.neutrals, "Harmonizing"],
                ] as const
              ).map(([title, swatches, verdict]) => (
                <div key={title}>
                  <p className="mb-2 text-nano uppercase tracking-label-max text-muted-foreground">
                    {title}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {swatches.map((sw) => (
                      <button
                        key={sw.hex + sw.name}
                        type="button"
                        onClick={() => setColour({ swatch: sw, verdict })}
                        aria-pressed={colour?.swatch.hex === sw.hex}
                        aria-label={`${sw.name} — ${sw.tip}`}
                        title={sw.name}
                        className={cn(
                          "atelier-focus-ring size-10 rounded-full border transition-transform",
                          colour?.swatch.hex === sw.hex
                            ? "scale-110 border-accent ring-2 ring-accent/40"
                            : "border-border hover:scale-105",
                        )}
                        style={{ backgroundColor: sw.hex }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div>
                <p className="mb-2 text-nano uppercase tracking-label-max text-muted-foreground">
                  Colours to avoid
                </p>
                {/* No opacity: a swatch dimmed to 80% is simply the wrong colour,
                    and "avoid" is carried by the heading, not by fading it. */}
                <div className="flex flex-wrap gap-2">
                  {palette.avoid.map((sw) => (
                    <span
                      key={sw.hex + sw.name}
                      title={`${sw.name} — ${sw.tip}`}
                      className="size-10 rounded-full border border-border"
                      style={{ backgroundColor: sw.hex }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <p role="status" aria-live="polite" className="mt-4 text-sm">
            {selectedName ? (
              <>
                <span className="font-medium text-ink">{selectedName}</span>
                <span className="text-muted-foreground"> — {selectedNote}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Pick a shade to preview it.</span>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
