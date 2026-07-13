import { useState } from "react";
import { Info, ChevronDown, Archive, ShieldCheck, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  type DetailedColorProfile as StudioDossier,
  type Swatch,
  type StudioTelemetry,
  FACE_FULL_TO_SHORT,
} from "@/constants/style-profile";
import { DisruptiveToneCard } from "@/components/style-profile/shared";

export function StudioPortfolioView({
  profile,
  isDemo,
  telemetry,
}: {
  profile: StudioDossier;
  isDemo?: boolean;
  telemetry?: StudioTelemetry | null;
}) {
  const faceShort = FACE_FULL_TO_SHORT[profile.faceShape] ?? profile.faceShape;
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const dossierNumber = `${profile.season.slice(0, 2).toUpperCase()}–${faceShort.slice(0, 2).toUpperCase()}`;
  const primaryBlocks = profile.primarySwatches.slice(0, 4);
  const accentBlocks = (
    profile.accentSwatches && profile.accentSwatches.length > 0
      ? profile.accentSwatches
      : profile.secondarySwatches
  ).slice(0, 2);
  const accentCopy = [
    "Apply near the face via luxury knitwear, silks, or lapel accents.",
    "Perfect for hardware choices, soft evening tailoring, and foundational silk linings.",
  ];
  const omitTones = profile.avoidColors.slice(0, 3).map((line) => {
    const [name] = line.split(/[—(]/);
    return name.trim();
  });
  return (
    <section className="mt-10 border border-foreground/15 bg-card animate-fade-in">
      <header className="px-6 sm:px-10 pt-10 pb-8 border-b-[0.5px] border-border">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-foreground text-background text-[9px] uppercase tracking-[0.32em] font-medium">
            <ShieldCheck className="size-3" /> Seoul Atelier Record
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {telemetry && !isDemo && (
              <button
                type="button"
                onClick={() => setTelemetryOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 border-[0.5px] border-foreground/30 bg-background text-foreground/80 text-[9px] uppercase tracking-[0.32em] hover:bg-foreground hover:text-background transition-colors"
                aria-expanded={telemetryOpen}
              >
                <FlaskConical className="size-3" /> Studio notes
                <ChevronDown
                  className={`size-3 transition-transform ${telemetryOpen ? "rotate-180" : ""}`}
                />
              </button>
            )}
            {!isDemo && profile.calibrationSource && (
              <span className="text-[9px] uppercase tracking-[0.32em] text-foreground border-[0.5px] border-foreground/60 px-2 py-1">
                {profile.confidenceLabel
                  ? profile.confidenceLabel
                  : profile.calibrationSource === "Studio Calibrated"
                    ? "100% · Studio Tuned"
                    : `${Math.round(profile.confidenceScore ?? 0)}% · AI Vision`}
              </span>
            )}
          </div>
        </div>

        {telemetry && !isDemo && telemetryOpen && (
          <pre className="mb-8 p-4 bg-foreground/4 border-[0.5px] border-foreground/15 font-mono text-[10px] leading-relaxed text-foreground/80 whitespace-pre-wrap wrap-break-word">
            {`// Studio notes ${telemetry.source ? `· ${telemetry.source.toUpperCase()}` : ""}
First look · light       : ${telemetry.pass1Raw.ambientLighting}
First look · undertone   : ${telemetry.pass1Raw.biologicalUndertone}
First look · contrast    : ${telemetry.pass1Raw.computedContrast}
Adjusted by Mila         : ${telemetry.interceptTriggered ? "yes" : "no"}
Sample run               : ${telemetry.forcedDiagnostic ? "yes" : "no"}
Stylist's notes          : ${telemetry.gatekeeperNotes.length ? telemetry.gatekeeperNotes.join(" | ") : "none"}

// Final read
  Light                  : ${telemetry.pass2OverrideInputs.ambientLighting}
  Undertone              : ${telemetry.pass2OverrideInputs.biologicalUndertone}
  Contrast               : ${telemetry.pass2OverrideInputs.computedContrast}
  Tricky lighting        : ${telemetry.pass2OverrideInputs.sensorClippingEvent ? "yes" : "no"}`}
          </pre>
        )}

        <div className="space-y-12">
          <div className="border-b border-border/60 pb-6 text-center md:text-left">
            <span className="text-[9px] uppercase tracking-[0.32em] text-accent block mb-1">
              Dossier N° {dossierNumber}
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl text-foreground tracking-tight font-medium">
              {profile.subSeason}
            </h2>
            <p className="text-sm text-muted-foreground font-sans mt-1">
              A curated spatial canvas of your seasonal harmonies · {profile.brightness} ·{" "}
              {profile.saturation}
            </p>
          </div>

          {primaryBlocks.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-[0.32em] text-foreground font-medium inline-flex items-center gap-1.5">
                Primary Core Tones
                <InfoDot text="The specific color families that naturally complement your skin undertone, bringing out a healthy, radiant glow." />
              </h3>
              <div
                className={`grid grid-cols-1 sm:grid-cols-2 ${primaryBlocks.length >= 4 ? "md:grid-cols-4" : `md:grid-cols-${primaryBlocks.length}`} gap-3`}
              >
                {primaryBlocks.map((block, i) => {
                  const ink = readableInk(block.hex);
                  const role =
                    ["Base Silhouette", "Contrast Highlight", "Soft Structure", "Midnight Anchor"][
                      i
                    ] ?? "Signature Tone";
                  return (
                    <div
                      key={`${block.hex}-${i}`}
                      className="group relative rounded-2xl overflow-hidden border border-border shadow-sm transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:shadow-xl"
                    >
                      <div className="w-full h-25 relative" style={{ backgroundColor: block.hex }}>
                        <span
                          className="absolute top-3 right-3 text-[8px] tracking-[0.2em] font-mono uppercase opacity-80"
                          style={{
                            color: ink,
                            textShadow: ink === "#ffffff" ? "0 1px 2px rgba(0,0,0,0.25)" : "none",
                          }}
                        >
                          {block.hex.toUpperCase()}
                        </span>
                      </div>
                      <div className="bg-card/95 backdrop-blur-md p-4 flex flex-col justify-between border-t border-border min-h-22">
                        <div className="flex justify-between items-start gap-2">
                          <h4 className="font-serif text-base text-foreground font-medium leading-tight">
                            {block.name}
                          </h4>
                        </div>
                        <div className="text-[9px] uppercase tracking-[0.28em] text-accent font-medium">
                          {role}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {accentBlocks.length > 0 && (
            <div className="space-y-4 pt-2">
              <h3 className="text-[10px] uppercase tracking-[0.32em] text-foreground font-medium">
                Seasonal Accent Infusions
              </h3>
              <div
                className={`grid grid-cols-1 ${accentBlocks.length > 1 ? "md:grid-cols-2" : ""} gap-4`}
              >
                {accentBlocks.map((block, i) => (
                  <div
                    key={`${block.hex}-${i}`}
                    className="relative rounded-2xl overflow-hidden flex shadow-sm border border-border"
                  >
                    <div
                      className="w-1/3 h-25 self-stretch"
                      style={{ backgroundColor: block.hex }}
                    />
                    <div className="w-2/3 bg-card p-5 flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] uppercase tracking-[0.2em] text-accent font-semibold">
                          {i === 0 ? "Aura Tone" : "Illuminator"}
                        </span>
                        <h4 className="font-serif text-lg text-foreground mt-0.5 leading-tight">
                          {block.name}
                        </h4>
                      </div>
                      <p className="text-xs text-muted-foreground font-sans leading-relaxed">
                        {accentCopy[i] ??
                          "Layer in to lift the silhouette and personalize the seasonal read."}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {omitTones.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-[10px] uppercase tracking-[0.32em] text-destructive font-medium">
                Disruptive Tones
              </h3>
              <div className="flex flex-col gap-2">
                {omitTones.map((name, idx) => (
                  <DisruptiveToneCard key={`${name}-${idx}`} name={name} height={56} />
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 border-t-[0.5px] border-border">
            <DossierCell label="Tone Type" value={profile.toneType} />
            <DossierCell
              label="Face Shape Structure"
              value={profile.faceShape}
              info="The structural outline of your face. Knowing this helps you choose optimal haircuts, collar shapes, and eyewear frames."
            />
            <DossierCell
              label="Feature Contrast Index"
              value={profile.contrastScale}
              info="The difference in lightness and darkness between your skin, eyes, and hair. High contrast looks striking in bold blocks; low contrast shines in soft, tonal, monochromatic outfits."
              last
            />
          </div>
          <ContrastGauge value={profile.contrastScale} />
        </div>
      </header>

      <SectionBlock
        numeral="I"
        title="Atelier Palette Matrix"
        info="The full 20-hex PCCS matrix that anchors your seasonal harmonies."
      >
        <PaletteCard
          title={profile.subSeason}
          fullPalette={profile.fullPalette}
          swatches={[
            ...profile.primarySwatches,
            ...profile.secondarySwatches,
            ...(profile.accentSwatches ?? []),
          ]}
        />
      </SectionBlock>

      <div className="space-y-6 px-9 pt-8 border-t border-porcelain/30">
        <div className="flex justify-between items-end mb-2">
          <h3 className="text-xs uppercase tracking-[0.2em] text-ink font-semibold">
            The Beauty Canvas
          </h3>
          <span className="text-[10px] text-stone uppercase tracking-widest">
            Cosmetic Harmonies
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card p-6 rounded-card border border-border shadow-paper space-y-6">
            <div className="text-center pb-4 border-b border-porcelain/50">
              <h4 className="font-serif text-lg text-ink">The Signature Lip</h4>
              <p className="text-[10px] text-stone uppercase tracking-widest mt-1">
                Pigment &amp; Finish
              </p>
            </div>
            <div className="space-y-4">
              {[
                { name: "Rosewood Balm", type: "Everyday Sheer", swatch: "oklch(0.60 0.12 15)" },
                { name: "Crushed Velvet", type: "Statement Matte", swatch: "oklch(0.40 0.15 15)" },
                { name: "Tawny Nude", type: "Soft Satin", swatch: "oklch(0.70 0.08 45)" },
              ].map((lip, i) => (
                <div key={i} className="flex items-center gap-4 group">
                  <div
                    className="size-10 rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] border border-stone/10 shrink-0 transition-transform group-hover:scale-110"
                    style={{ backgroundColor: lip.swatch }}
                  />
                  <div>
                    <h5 className="font-serif text-sm text-ink">{lip.name}</h5>
                    <span className="text-[9px] uppercase tracking-widest text-stone">
                      {lip.type}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card p-6 rounded-card border border-border shadow-paper space-y-6">
            <div className="text-center pb-4 border-b border-porcelain/50">
              <h4 className="font-serif text-lg text-ink">The Natural Flush</h4>
              <p className="text-[10px] text-stone uppercase tracking-widest mt-1">
                Cheek &amp; Warmth
              </p>
            </div>
            <div className="space-y-4">
              {[
                {
                  name: "Muted Mauve",
                  type: "Cream Blush",
                  swatch: "oklch(0.65 0.10 350)",
                  fade: "from-white/40",
                },
                {
                  name: "Warm Terracotta",
                  type: "Powder Sweep",
                  swatch: "oklch(0.65 0.12 40)",
                  fade: "from-white/60",
                },
                {
                  name: "Soft Apricot",
                  type: "Liquid Tint",
                  swatch: "oklch(0.80 0.08 55)",
                  fade: "from-white/30",
                },
              ].map((cheek, i) => (
                <div key={i} className="flex items-center gap-4 group">
                  <div
                    className="size-10 rounded-full shadow-inner border border-stone/10 shrink-0 relative overflow-hidden transition-transform group-hover:scale-110"
                    style={{ backgroundColor: cheek.swatch }}
                  >
                    <div
                      className={`absolute inset-0 bg-linear-to-tr ${cheek.fade} to-transparent opacity-80`}
                    />
                  </div>
                  <div>
                    <h5 className="font-serif text-sm text-ink">{cheek.name}</h5>
                    <span className="text-[9px] uppercase tracking-widest text-stone">
                      {cheek.type}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card p-6 rounded-card border border-border shadow-paper space-y-6">
            <div className="text-center pb-4 border-b border-porcelain/50">
              <h4 className="font-serif text-lg text-ink">Luminous Accents</h4>
              <p className="text-[10px] text-stone uppercase tracking-widest mt-1">
                Highlight &amp; Lid
              </p>
            </div>
            <div className="space-y-4">
              {[
                {
                  name: "Champagne Pearl",
                  type: "Highlighter",
                  swatch: "oklch(0.92 0.04 80)",
                  glow: "oklch(0.98 0.02 85)",
                },
                {
                  name: "Burnished Bronze",
                  type: "Lid Wash",
                  swatch: "oklch(0.55 0.08 55)",
                  glow: "oklch(0.65 0.10 55)",
                },
                {
                  name: "Soft Taupe",
                  type: "Crease Contour",
                  swatch: "oklch(0.70 0.03 60)",
                  glow: "oklch(0.75 0.02 60)",
                },
              ].map((accent, i) => (
                <div key={i} className="flex items-center gap-4 group">
                  <div
                    className="size-10 rounded-full shadow-inner border border-stone/10 shrink-0 relative overflow-hidden transition-transform group-hover:scale-110"
                    style={{ backgroundColor: accent.swatch }}
                  >
                    <div
                      className="absolute -inset-2 blur-sm opacity-60 rotate-45 transform translate-x-2 translate-y-1"
                      style={{ backgroundColor: accent.glow }}
                    />
                  </div>
                  <div>
                    <h5 className="font-serif text-sm text-ink">{accent.name}</h5>
                    <span className="text-[9px] uppercase tracking-widest text-stone">
                      {accent.type}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-9 pt-8 border-t border-porcelain/30">
        <div className="flex justify-between items-end mb-4">
          <h3 className="text-xs uppercase tracking-[0.2em] text-ink font-semibold">
            Textile Drape & Weight
          </h3>
          <span className="text-[10px] text-stone uppercase tracking-widest">
            Recommended Core Materials
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              material: profile.fabrication[0] ?? "Heavy Silk",
              drape: "Fluid & Luminous",
              color: "bg-card",
              border: "border-border",
            },
            {
              material: profile.fabrication[1] ?? "Crisp Linen",
              drape: "Structured & Matte",
              color: "bg-card",
              border: "border-border",
            },
            {
              material: profile.fabrication[2] ?? "Worsted Wool",
              drape: "Tailored & Dense",
              color: "bg-card",
              border: "border-border",
            },
            {
              material: profile.fabrication[3] ?? "Cashmere Blend",
              drape: "Soft & Haloed",
              color: "bg-card",
              border: "border-border",
            },
          ].map((fabric, idx) => (
            <div
              key={idx}
              className={`relative p-5 rounded-2xl border ${fabric.border} ${fabric.color} shadow-atelier-soft h-32 flex flex-col justify-end group transition-all duration-300 hover:shadow-md`}
            >
              <div className="absolute inset-0 bg-linear-to-tr from-white/10 to-transparent rounded-2xl pointer-events-none" />
              <div className="relative z-10">
                <h4 className="font-serif text-lg leading-tight text-ink">{fabric.material}</h4>
                <span className="text-[9px] uppercase tracking-[0.15em] block mt-1 text-stone">
                  {fabric.drape}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4 px-9 py-8">
        <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
          Recommended Textiles · Denim
        </p>
        <h3 className="text-xs uppercase tracking-[0.2em] text-ink font-semibold">
          The Denim Archive
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              wash: profile.denimRegistry[0] ?? "Raw Indigo",
              finish: "Untreated, crisp finish",
              swatch: "oklch(0.25 0.05 250)",
              thread: "oklch(0.75 0.15 65)",
            },
            {
              wash: profile.denimRegistry[1] ?? "Vintage Mid-Wash",
              finish: "Softened, natural fade",
              swatch: "oklch(0.55 0.08 245)",
              thread: "oklch(0.60 0.05 250)",
            },
            {
              wash: profile.denimRegistry[2] ?? "Bone Ecru",
              finish: "Unbleached natural cotton",
              swatch: "oklch(0.92 0.02 95)",
              thread: "oklch(0.85 0.03 90)",
            },
          ].map((denim, idx) => (
            <div
              key={idx}
              className="flex items-center gap-4 p-3 rounded-2xl bg-surface dark:bg-card border border-stone/10 shadow-atelier-soft"
            >
              <div
                className="size-16 rounded-full shrink-0 relative overflow-hidden shadow-inner border border-stone/10"
                style={{ backgroundColor: denim.swatch }}
              >
                <div
                  className="absolute left-3 top-0 bottom-0 w-px border-l border-dashed opacity-60"
                  style={{ borderColor: denim.thread }}
                />
                <div
                  className="absolute left-4 top-0 bottom-0 w-px border-l border-dashed opacity-60"
                  style={{ borderColor: denim.thread }}
                />
              </div>
              <div>
                <h4 className="font-serif text-base text-ink">{denim.wash}</h4>
                <p className="text-[10px] uppercase tracking-widest text-stone mt-1">
                  {denim.finish}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <SectionBlock
        numeral="V"
        title="Colors to Avoid"
        accent="destructive"
        info="Tones that compete with your natural coloring, which can make your complexion look tired, shadowed, or washed out under standard lighting."
      >
        <div className="border-t border-destructive/30">
          {profile.avoidColors.map((a, i) => {
            const [name, ...rest] = a.split(/[—(]/);
            const detail = rest
              .join(rest.length > 0 ? "—" : "")
              .replace(/\)\s*$/, "")
              .trim();
            return (
              <div
                key={i}
                className={`p-5 flex items-start gap-4 ${i < profile.avoidColors.length - 1 ? "border-b border-destructive/15" : ""}`}
              >
                <span className="mt-1 h-2 w-2 bg-destructive shrink-0" />
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-foreground">
                    {name.trim()}
                  </p>
                  {detail && (
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1">{detail}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SectionBlock>

      <div className="space-y-4 py-8 px-6 sm:px-10">
        <div className="flex justify-between items-end mb-2">
          <h3 className="text-xs uppercase tracking-[0.2em] text-ink font-semibold">
            Disruptive Tones
          </h3>
        </div>

        <div className="flex flex-col gap-3">
          {omitTones.map((name, idx) => (
            <DisruptiveToneCard key={`detailed-${name}-${idx}`} name={name} height={72} />
          ))}
        </div>
      </div>

      <section className="px-6 sm:px-10 py-8 border-t-[0.5px] border-border">
        <p className="text-[9px] uppercase tracking-[0.32em] text-accent">
          VI · Analyst's Personal Critique
        </p>
        <div className="mt-4 ml-2 sm:ml-6 border-[0.5px] border-border bg-accent-soft border-l-[3px] border-l-accent px-6 py-6">
          <blockquote className="font-serif text-base sm:text-lg italic leading-relaxed text-foreground">
            "{profile.stylistNote}"
          </blockquote>
          <div className="mt-5 flex items-center gap-3">
            <span className="h-px w-8 bg-foreground/40" />
            <p className="font-serif italic text-sm tracking-wide text-foreground/70">
              — Mila, your Atelier Stylist
            </p>
          </div>
        </div>
      </section>

      <div className="px-6 sm:px-10 py-6 border-t-[0.5px] border-border flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="text-[10px] uppercase tracking-[0.2em] gap-2 border-border hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Archive className="size-3.5" />
          Archive Dossier
        </Button>
      </div>
    </section>
  );
}

export function DossierCell({
  label,
  value,
  last,
  info,
}: {
  label: string;
  value: string;
  last?: boolean;
  info?: string;
}) {
  return (
    <div className={`p-4 ${!last ? "sm:border-r border-border" : ""}`}>
      <p className="text-[9px] uppercase tracking-[0.32em] text-accent inline-flex items-center gap-1.5">
        {label}
        {info && <InfoDot text={info} />}
      </p>
      <p className="font-serif text-base tracking-tight mt-1">{value}</p>
    </div>
  );
}

export function SectionBlock({
  numeral,
  title,
  children,
  accent,
  info,
}: {
  numeral: string;
  title: string;
  children: React.ReactNode;
  accent?: "destructive";
  info?: string;
}) {
  const isAlert = accent === "destructive";
  return (
    <section
      className={`px-6 sm:px-10 py-7 border-t ${isAlert ? "border-destructive/30 bg-destructive/2" : "border-border"}`}
    >
      <div className="flex items-baseline gap-3 mb-5">
        <span
          className={`font-serif text-2xl ${isAlert ? "text-destructive" : "text-foreground/30"}`}
        >
          {numeral}
        </span>
        <h4
          className={`text-[10px] uppercase tracking-[0.32em] font-medium inline-flex items-center gap-1.5 ${isAlert ? "text-destructive" : "text-foreground"}`}
        >
          {title}
          {info && <InfoDot text={info} tone={isAlert ? "destructive" : "default"} />}
        </h4>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function InfoDot({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "destructive";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className={`inline-flex items-center justify-center size-3.5 rounded-full transition-opacity opacity-60 hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40 ${tone === "destructive" ? "text-destructive/70" : "text-muted-foreground"}`}
        >
          <Info className="size-3" strokeWidth={1.25} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-64 p-3 border-[0.5px] border-border bg-card text-xs leading-relaxed text-foreground/80 normal-case tracking-normal font-sans rounded-none shadow-md"
      >
        {text}
      </PopoverContent>
    </Popover>
  );
}

export function PaletteCard({
  title,
  swatches,
  fullPalette,
}: {
  title: string;
  swatches: Swatch[];
  fullPalette?: string[];
}) {
  let dots: Swatch[] = [];
  if (fullPalette && fullPalette.length > 0) {
    dots = fullPalette.slice(0, 20).map((hex) => ({ hex, name: hex.toUpperCase() }));
  } else if (swatches.length > 0) {
    for (let i = 0; i < 20; i++) dots.push(swatches[i % swatches.length]);
  }
  const [main, ...rest] = title.split(/\s+/);
  return (
    <div className="rounded-2xl bg-atelier-porcelain dark:bg-neutral-200 px-6 pt-7 pb-10 sm:px-10 sm:pt-10 sm:pb-14 shadow-sm">
      <div className="text-center">
        <h5 className="font-serif italic tracking-tight text-2xl sm:text-3xl text-neutral-900">
          {main?.toUpperCase()}
          {rest.length > 0 && (
            <span className="ml-2 not-italic font-light text-neutral-700">
              {rest.join(" ").toUpperCase()}
            </span>
          )}
        </h5>
        <p className="mt-1 text-[11px] tracking-[0.5em] text-neutral-700 uppercase">
          P a l e t t e
        </p>
      </div>
      <div className="mt-7 mx-auto max-w-70 grid grid-cols-5 gap-3 sm:gap-4">
        {dots.map((s, i) => (
          <div
            key={i}
            className="aspect-square rounded-full ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
            style={{ backgroundColor: s.hex }}
            title={`${s.name} ${s.hex}`}
          />
        ))}
      </div>
      <p className="mt-7 text-center font-serif italic text-base text-neutral-700/80 tracking-wide leading-relaxed">
        Atelier Collection
      </p>
    </div>
  );
}

export function readableInk(hex: string): "#ffffff" | "#0a0a0a" {
  const m = hex.replace("#", "");
  if (m.length !== 6) return "#0a0a0a";
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#0a0a0a" : "#ffffff";
}

export function ContrastGauge({ value }: { value: string }) {
  const v = (value || "").toLowerCase();
  let raw = 50;
  if (/very high|striking|block|maximal|dramatic/.test(v)) raw = 92;
  else if (/high/.test(v)) raw = 78;
  else if (/medium-high|mid-high/.test(v)) raw = 65;
  else if (/medium|moderate|balanced/.test(v)) raw = 50;
  else if (/medium-low|mid-low/.test(v)) raw = 35;
  else if (/very low|monochromatic|minimal/.test(v)) raw = 10;
  else if (/low|muted|soft|tonal/.test(v)) raw = 22;
  const pct = Math.max(4, Math.min(96, raw));
  return (
    <div className="mt-6 border-t-[0.5px] border-border pt-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] uppercase tracking-[0.32em] text-accent">Contrast Spectrum</p>
        <p className="text-[9px] uppercase tracking-[0.32em] text-foreground font-medium">
          {value}
        </p>
      </div>
      <div className="relative h-1 rounded-full bg-foreground/15">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
          style={{ left: `${pct}%` }}
        >
          <div className="h-3.25 w-3.25 rounded-full bg-background border-2 border-foreground shadow-sm" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[8px] uppercase tracking-[0.28em] text-accent">
        <span>Low · Muted / Monochromatic</span>
        <span>High · Striking / Block</span>
      </div>
    </div>
  );
}
