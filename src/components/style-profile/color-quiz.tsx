import { useState } from "react";
import { ArrowLeft, Sun, ShieldCheck, X as XIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Season,
  type Tone,
  SEASON_PALETTES,
  SEASON_EDUCATION,
  SEASON_DETAIL,
  AESTHETIC_MOODS,
} from "@/constants/style-profile";

export type Hue = "Warm" | "Cool";
export type Value = "Light" | "Deep";
export type Chroma = "Bright" | "Muted";
export type AestheticPersona = string;
export type SubModifier = "Deep" | "Light" | "Bright" | "Soft" | "Warm" | "Cool" | null;
export type DetailedColorProfile = {
  season: Season;
  subSeason: string;
  modifier: SubModifier;
  undertone: Tone;
  selectedAesthetic: string | null;
  axes: { hue: Hue; value: Value; chroma: Chroma };
  inputs: {
    drape: "Warm" | "Cool";
    hairDepth: string;
    eyeBrightness: string;
    lightingConfirmed: boolean;
  };
  primary: any[];
  secondary: any[];
  accent: any[];
  avoid: string[];
  tagline: string;
  education: string;
  version: 2;
  stylistNote?: string;
  aiConfidence?: number;
};
export function ColorQuiz({
  onClose,
  onComplete,
  userId,
}: {
  onClose: () => void;
  onComplete: (r: any) => void;
  userId?: string;
}) {
  const [step, setStep] = useState(0);
  const lightingConfirmed = false;
  const [hue, setHue] = useState<Hue | null>(null);
  const [drape, setDrape] = useState<"Warm" | "Cool" | null>(null);
  const [value, setValue] = useState<Value | null>(null);
  const [hairDepth, setHairDepth] = useState<string | null>(null);
  const [eyeBrightness, setEyeBrightness] = useState<string | null>(null);
  const [chroma, setChroma] = useState<Chroma | null>(null);
  const [, setSelectedAesthetic] = useState<AestheticPersona | null>(null);
  const [result, setResult] = useState<DetailedColorProfile | null>(null);
  const [saving, setSaving] = useState(false);

  async function complete(finalAesthetic: AestheticPersona) {
    if (!hue || !value || !drape || !hairDepth || !eyeBrightness || !chroma) return;
    const season: Season =
      hue === "Warm"
        ? value === "Light"
          ? "Spring"
          : "Autumn"
        : value === "Light"
          ? "Summer"
          : "Winter";
    const detail = SEASON_DETAIL[season];
    const profile: DetailedColorProfile = {
      season,
      subSeason: `${chroma === "Muted" ? "Soft" : "Bright"} ${season}`,
      modifier: null,
      undertone: hue,
      selectedAesthetic: finalAesthetic,
      axes: { hue, value, chroma },
      inputs: { drape, hairDepth, eyeBrightness, lightingConfirmed },
      primary: detail.primary,
      secondary: detail.secondary,
      accent: detail.accent,
      avoid: detail.avoid,
      tagline: SEASON_PALETTES[season].tagline,
      education: SEASON_EDUCATION[season],
      version: 2,
    };
    if (userId) {
      setSaving(true);
      await supabase.from("profiles").upsert({
        id: userId,
        skin_undertone: hue,
        color_season: season,
        color_profile: profile as any,
        updated_at: new Date().toISOString(),
      } as any);
      setSaving(false);
    }
    setSelectedAesthetic(finalAesthetic);
    setResult(profile);
    onComplete({ hue, value, chroma, season, undertone: hue, profile });
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-0 sm:p-4">
      <div className="bg-card w-full sm:border sm:border-border max-w-2xl h-full sm:h-auto sm:max-h-[92vh] overflow-y-auto flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b-[0.5px] border-border flex items-center justify-between shrink-0">
          <p className="text-[10px] uppercase tracking-[0.25em] text-accent">
            Color Quiz · Step {step + 1} of 8
          </p>
          <button
            onClick={onClose}
            className="text-xs font-serif uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>
        <div className="p-6 md:p-10 flex-1 overflow-y-auto">
          {result ? (
            <DetailedColorResultView profile={result} onClose={onClose} />
          ) : step === 0 ? (
            <LightingStep onConfirm={() => setStep(1)} />
          ) : step === 1 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight leading-snug">
                Let's find your underlying warmth.
                <br />
                Which colors feel most natural against your skin?
              </h3>
              <div className="flex flex-col gap-4">
                <button
                  onClick={() => {
                    setHue("Warm");
                    setStep(2);
                  }}
                  className="w-full text-left border-[0.5px] border-border rounded-none overflow-hidden transition-all hover:border-foreground/40"
                >
                  <div className="h-28 w-full flex">
                    <div className="h-full w-1/2 bg-[#D4A24C]" />
                    <div className="h-full w-1/2 bg-[#C97B3D]" />
                  </div>
                  <div className="p-4">
                    <p className="text-xs uppercase font-medium tracking-widest">Warm Gold Tones</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Gold jewelry feels effortless on you, and warm sunlit hues bring your skin to
                      life.
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setHue("Cool");
                    setStep(2);
                  }}
                  className="w-full text-left border-[0.5px] border-border rounded-none overflow-hidden transition-all hover:border-foreground/40"
                >
                  <div className="h-28 w-full flex">
                    <div className="h-full w-1/2 bg-[#C0C0C0]" />
                    <div className="h-full w-1/2 bg-[#5B6A8A]" />
                  </div>
                  <div className="p-4">
                    <p className="text-xs uppercase font-medium tracking-widest">
                      Cool Platinum Tones
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Silver and crisp whites flatter your features, leaving your skin looking fresh
                      and clear.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight leading-snug">
                A quick drape test.
                <br />
                Which swatch softens shadows around your eyes?
              </h3>
              <div className="flex flex-col gap-4">
                <button
                  onClick={() => {
                    setDrape("Cool");
                    setStep(3);
                  }}
                  className="w-full text-left border-[0.5px] border-border overflow-hidden rounded-none transition-all hover:border-foreground/40"
                >
                  <div className="h-32 w-full bg-[#1E3A8A]" />
                  <div className="p-4">
                    <p className="text-xs uppercase font-medium tracking-widest">
                      Royal Cobalt — cool
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      If this deep blue makes you look more rested and refreshed, you lean cool.
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setDrape("Warm");
                    setStep(3);
                  }}
                  className="w-full text-left border-[0.5px] border-border overflow-hidden rounded-none transition-all hover:border-foreground/40"
                >
                  <div className="h-32 w-full bg-[#C2410C]" />
                  <div className="p-4">
                    <p className="text-xs uppercase font-medium tracking-widest">
                      Burnt Rust — warm
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      If this rich amber smooths and warms your skin, you lean warm.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          ) : step === 3 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight leading-snug">
                Now look at your natural contrast.
                <br />
                How do your features sit against your skin?
              </h3>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    setValue("Light");
                    setStep(4);
                  }}
                  className="border-[0.5px] border-border p-5 text-left rounded-none transition-all hover:border-foreground/40"
                >
                  <p className="text-xs uppercase font-medium tracking-widest">
                    Soft, low contrast
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your hair, eyes and skin blend gently together, sitting within a softer overall
                    range.
                  </p>
                </button>
                <button
                  onClick={() => {
                    setValue("Deep");
                    setStep(4);
                  }}
                  className="border-[0.5px] border-border p-5 text-left rounded-none transition-all hover:border-foreground/40"
                >
                  <p className="text-xs uppercase font-medium tracking-widest">
                    Striking, high contrast
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Rich, darker eyes or hair stand out clearly and beautifully against your
                    complexion.
                  </p>
                </button>
              </div>
            </div>
          ) : step === 4 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight text-center">
                What is your natural hair depth?
              </h3>
              <div className="flex flex-col gap-2">
                {[
                  "Light blonde or golden amber",
                  "Medium auburn or chestnut brown",
                  "Deep espresso or soft jet black",
                ].map((h) => (
                  <button
                    key={h}
                    onClick={() => {
                      setHairDepth(h);
                      setStep(5);
                    }}
                    className="border-[0.5px] border-border p-4 text-xs font-medium uppercase tracking-wider text-left rounded-none hover:bg-foreground/2 transition-all"
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          ) : step === 5 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight leading-snug">
                Look closely at your eyes.
                <br />
                How would you describe your iris?
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => {
                    setEyeBrightness("Bright");
                    setStep(6);
                  }}
                  className="border-[0.5px] border-border p-5 text-left rounded-none transition-all hover:border-foreground/40"
                >
                  <p className="text-xs uppercase font-medium tracking-widest">
                    Glassy and jewel-like
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    A clear contrast between the whites and the iris — luminous amber, crisp blue,
                    or vivid hazel.
                  </p>
                </button>
                <button
                  onClick={() => {
                    setEyeBrightness("Soft");
                    setStep(6);
                  }}
                  className="border-[0.5px] border-border p-5 text-left rounded-none transition-all hover:border-foreground/40"
                >
                  <p className="text-xs uppercase font-medium tracking-widest">
                    Smoky and softly blended
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your iris blends gently — perhaps muted grey-blue, deep rich brown, or soft
                    dusty olive.
                  </p>
                </button>
              </div>
            </div>
          ) : step === 6 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight leading-snug">
                A quick saturation check.
                <br />
                Which tones bring out your natural presence?
              </h3>
              <div className="flex flex-col gap-4">
                <button
                  onClick={() => {
                    setChroma("Bright");
                    setStep(7);
                  }}
                  className="w-full text-left border-[0.5px] border-border rounded-none p-4 transition-all hover:border-foreground/40"
                >
                  <div className="flex gap-1.5 mb-3">
                    <div className="h-6 w-full bg-[#E0144C]" />
                    <div className="h-6 w-full bg-[#00BFFF]" />
                    <div className="h-6 w-full bg-[#FF1493]" />
                  </div>
                  <p className="text-xs uppercase font-medium tracking-widest">Clear and vibrant</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Pure, energetic, fully saturated colors make you stand out instantly.
                  </p>
                </button>
                <button
                  onClick={() => {
                    setChroma("Muted");
                    setStep(7);
                  }}
                  className="w-full text-left border-[0.5px] border-border rounded-none p-4 transition-all hover:border-foreground/40"
                >
                  <div className="flex gap-1.5 mb-3">
                    <div className="h-6 w-full bg-[#7E97AB]" />
                    <div className="h-6 w-full bg-[#B58867]" />
                    <div className="h-6 w-full bg-[#5B7053]" />
                  </div>
                  <p className="text-xs uppercase font-medium tracking-widest">
                    Powdered and earthy
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Muted velvets, dusted sages, and smoke-kissed hues look quietly elevated on you.
                  </p>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight text-center">
                Choose your signature aesthetic:
              </h3>
              <div className="grid grid-cols-1 gap-2 max-h-[50vh] overflow-y-auto">
                {AESTHETIC_MOODS.map((m) => (
                  <button
                    key={m.id}
                    disabled={saving}
                    onClick={() => {
                      setSelectedAesthetic(m.id);
                      complete(m.id);
                    }}
                    className="border-[0.5px] border-border p-3 flex gap-4 items-center text-left rounded-none hover:border-foreground/40 transition-all"
                  >
                    <img src={m.img} className="h-14 w-11 object-cover filter grayscale" />
                    <div>
                      <p className="text-xs uppercase font-medium tracking-wider">{m.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                        {m.desc}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {step > 0 && !result && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep(step - 1)}
              className="text-xs uppercase tracking-widest mt-6 rounded-none gap-1"
            >
              <ArrowLeft className="size-3" /> Back
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function LightingStep({ onConfirm }: { onConfirm: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="space-y-5">
      <h3 className="font-serif text-2xl flex items-center gap-2 tracking-tight">
        <Sun className="size-5" /> Let's find your light
      </h3>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Find a spot with soft, natural day lighting so I can see your true tones. Step away from
        harsh overhead bulbs, yellow lamps, and deep shadows — that's where your undertones come
        through clearest.
      </p>
      <label className="flex items-start gap-3 border-[0.5px] border-border p-4 cursor-pointer rounded-none">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 accent-foreground"
        />
        <span className="text-xs text-muted-foreground leading-relaxed">
          I'm currently in soft, indirect natural daylight.
        </span>
      </label>
      <p className="text-[10px] uppercase tracking-[0.22em] text-accent leading-relaxed">
        Prefer a live AI scan? Close this quiz and tap{" "}
        <span className="text-foreground">Run Visual Diagnostic</span> on the studio dossier to
        launch the camera viewfinder.
      </p>
      <div className="flex justify-end pt-4 border-t-[0.5px] border-border">
        <Button
          size="sm"
          className="text-xs uppercase tracking-widest rounded-none h-9 px-6"
          onClick={onConfirm}
          disabled={!confirmed}
        >
          Continue manually
        </Button>
      </div>
    </div>
  );
}

export function DetailedColorResultView({
  profile,
  onClose,
}: {
  profile: DetailedColorProfile;
  onClose: () => void;
}) {
  const detail = SEASON_DETAIL[profile.season];
  return (
    <div className="space-y-8 animate-fade-in text-left max-w-xl mx-auto">
      <div className="text-center border-b-[0.5px] border-border pb-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-foreground text-background text-[9px] uppercase tracking-widest font-medium">
          <ShieldCheck className="size-3.5" /> SEOUL DIGITAL DIAGNOSTIC REUSE
        </div>
        <p className="text-[10px] uppercase tracking-[0.25em] text-accent mt-5 mb-1">
          Your Diagnostic Palette
        </p>
        <h3 className="font-serif text-3xl sm:text-4xl tracking-tight font-medium">
          {profile.subSeason}
        </h3>
        <p className="text-[11px] font-sans tracking-wide text-muted-foreground mt-2 leading-relaxed">
          {profile.education}
        </p>
        {profile.stylistNote && (
          <div className="mt-5 border-l-2 border-foreground/40 pl-3 text-left max-w-md mx-auto">
            <p className="text-[9px] uppercase tracking-[0.25em] text-accent mb-1">
              Stylist Note
              {typeof profile.aiConfidence === "number"
                ? ` · ${Math.round(profile.aiConfidence)}% confidence`
                : ""}
            </p>
            <p className="font-serif text-sm italic text-foreground leading-relaxed">
              "{profile.stylistNote}"
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="border-[0.5px] border-border p-3 bg-foreground/1">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Tone Type</p>
          <p className="font-medium text-xs uppercase mt-0.5">
            {profile.axes.chroma === "Muted" ? "Soft / Muted Tone" : "Clear / Vivid Tone"}
          </p>
        </div>
        <div className="border-[0.5px] border-border p-3 bg-foreground/1">
          <p className="text-[9px] uppercase tracking-wider text-destructive">
            Grave Color (Worst Tone)
          </p>
          <p className="font-medium text-xs uppercase mt-0.5 text-destructive/90">
            Avoid Next to Face
          </p>
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-accent font-semibold mb-3">
          I. Best Draping Swatches
        </p>
        <div className="grid grid-cols-4 gap-2">
          {profile.primary.map((s, i) => (
            <div key={i} className="space-y-1">
              <div
                className="h-12 border-[0.5px] border-border"
                style={{ backgroundColor: s.hex }}
              />
              <p className="text-[9px] uppercase tracking-wide text-accent truncate">{s.name}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-foreground/10 bg-foreground/2 p-5 space-y-3">
        <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-foreground">
          II. K-Beauty Studio Prescription
        </p>
        <ul className="space-y-2">
          {detail.beauty.map((tip, i) => {
            const [label, text] = tip.split(": ");
            return (
              <li key={i} className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground font-medium uppercase text-[10px] tracking-wider block mb-0.5">
                  {label}
                </strong>
                {text}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border border-destructive/10 bg-destructive/1 p-4">
        <p className="text-[10px] uppercase text-destructive tracking-widest mb-2 flex items-center gap-1">
          <XIcon className="size-3" /> Grave Tone Exclusions
        </p>
        <div className="flex flex-col gap-1.5">
          {profile.avoid.map((a) => (
            <span
              key={a}
              className="text-[11px] text-muted-foreground font-sans leading-relaxed flex items-center gap-2"
            >
              <span className="h-1 w-1 bg-destructive/50 shrink-0" /> {a}
            </span>
          ))}
        </div>
      </div>

      <Button
        onClick={onClose}
        className="w-full text-xs uppercase tracking-widest h-11 rounded-none bg-foreground text-background"
      >
        Complete Session Validation
      </Button>
    </div>
  );
}
