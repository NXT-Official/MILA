import { useEffect, useRef, useState } from "react";
import { ImageIcon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraCapture } from "@/components/capture/camera-capture";
import { cn } from "@/lib/utils";
import type { DetailedColorProfile as StudioDossier, Swatch } from "@/constants/style-profile";

type Verdict = "Ideal" | "Harmonizing" | "Accent";

const VERDICT_CAPTION: Record<Verdict, string> = {
  Ideal: "Sits closest to your own coloring — wear it near the face without a second thought.",
  Harmonizing: "Works, but reads quieter. Best as the second or third colour in a look.",
  Accent: "One deliberate note — a scarf, a lip, a shoe. Not the whole outfit.",
};

const BEAUTY_CATEGORIES = [
  { key: "lip", label: "Lip" },
  { key: "base", label: "Base" },
  { key: "hair", label: "Hair" },
] as const;

function SwatchRow({
  title,
  verdict,
  swatches,
  selected,
  onSelect,
}: {
  title: string;
  verdict: Verdict;
  swatches: Swatch[];
  selected: Swatch | null;
  onSelect: (swatch: Swatch, verdict: Verdict) => void;
}) {
  if (!swatches.length) return null;
  return (
    <div>
      <p className="atelier-kicker mb-2">{title}</p>
      <div className="flex flex-wrap gap-2">
        {swatches.map((swatch) => {
          const active = selected?.hex === swatch.hex;
          return (
            <button
              key={`${swatch.hex}-${swatch.name}`}
              type="button"
              onClick={() => onSelect(swatch, verdict)}
              aria-pressed={active}
              title={swatch.name}
              className={cn(
                "atelier-focus-ring size-10 rounded-full border transition-transform",
                active ? "scale-110 border-accent ring-2 ring-accent/40" : "border-line",
              )}
              style={{ backgroundColor: swatch.hex }}
            >
              <span className="sr-only">
                {swatch.name} — {verdict}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tries the member's own palette against their own face. A named swatch list
 * tells you nothing about whether a colour lifts *your* skin — draping one
 * against the jaw is how the judgement is actually made in a studio.
 */
export function PhotoTryOn({ dossier }: { dossier: StudioDossier }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ swatch: Swatch; verdict: Verdict } | null>(null);
  const [category, setCategory] = useState<(typeof BEAUTY_CATEGORIES)[number]["key"]>("lip");
  const fileRef = useRef<HTMLInputElement>(null);

  // The photo never leaves the browser — it lives as an object URL and dies with it.
  useEffect(() => {
    if (!photoUrl) return;
    return () => URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  function applyPhoto(file: File) {
    setPhotoUrl(URL.createObjectURL(file));
  }

  function reset() {
    setPhotoUrl(null);
    setSelected(null);
  }

  return (
    <section className="atelier-card p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="h-px w-8 bg-foreground/60" />
        <p className="atelier-kicker">Try It On · Live Drape</p>
      </div>
      <h2 className="font-serif text-2xl sm:text-3xl tracking-tight mt-3">
        See your palette on your own face.
      </h2>
      <p className="mt-2 text-sm text-muted-foreground max-w-xl">
        Take a selfie in even, natural light, then drape a colour under your chin. Stays on this
        device — nothing is uploaded.
      </p>

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

      {!photoUrl ? (
        <div className="mt-6 max-w-md">
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
      ) : (
        <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div>
            <div className="relative aspect-3/4 overflow-hidden rounded-card border border-line bg-black">
              {selected && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-10"
                  style={{
                    background: `radial-gradient(120% 80% at 50% 0%, ${selected.swatch.hex}00 35%, ${selected.swatch.hex} 100%)`,
                    mixBlendMode: "soft-light",
                  }}
                />
              )}
              <img
                src={photoUrl}
                alt="Your photo, for trying colors against"
                className="absolute inset-0 h-full w-full object-cover"
              />
              {selected && (
                // The drape itself: solid colour at the collar, where a garment sits.
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[28%]"
                  style={{
                    background: `linear-gradient(to bottom, ${selected.swatch.hex}00, ${selected.swatch.hex} 45%)`,
                  }}
                />
              )}
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <Button variant="outline" size="pill" onClick={() => fileRef.current?.click()}>
                <ImageIcon aria-hidden="true" /> Choose another photo
              </Button>
              <Button variant="ghost" size="pill" onClick={reset}>
                <RotateCcw aria-hidden="true" /> Retake
              </Button>
            </div>

            <p role="status" aria-live="polite" className="mt-3 text-sm">
              {selected ? (
                <>
                  <span className="font-medium text-ink">{selected.swatch.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    — {selected.verdict}. {VERDICT_CAPTION[selected.verdict]}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Pick a colour to drape it.</span>
              )}
            </p>
          </div>

          <div className="space-y-6">
            <SwatchRow
              title="Ideal · your core palette"
              verdict="Ideal"
              swatches={dossier.primarySwatches}
              selected={selected?.swatch ?? null}
              onSelect={(swatch, verdict) => setSelected({ swatch, verdict })}
            />
            <SwatchRow
              title="Harmonizing · supporting tones"
              verdict="Harmonizing"
              swatches={dossier.secondarySwatches}
              selected={selected?.swatch ?? null}
              onSelect={(swatch, verdict) => setSelected({ swatch, verdict })}
            />
            <SwatchRow
              title="Accent · use sparingly"
              verdict="Accent"
              swatches={dossier.accentSwatches}
              selected={selected?.swatch ?? null}
              onSelect={(swatch, verdict) => setSelected({ swatch, verdict })}
            />

            {dossier.avoidColors.length > 0 && (
              <div>
                <p className="atelier-kicker mb-2">Avoid near the face</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {dossier.avoidColors.map((color) => (
                    <li key={color} className="flex gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-rose"
                      />
                      <span>{color}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="flex gap-2">
                {BEAUTY_CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCategory(c.key)}
                    aria-pressed={category === c.key}
                    className={cn(
                      "atelier-focus-ring rounded-pill border px-4 py-1.5 text-micro uppercase tracking-label transition-colors",
                      category === c.key
                        ? "border-accent bg-accent-soft/50 text-ink"
                        : "border-line text-muted-foreground hover:text-ink",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                {dossier.beautyMap[category]}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
