// src/routes/_authenticated/style-profile.tsx

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { analyzePersonalColor as analyzeStudioColor, type StudioColorProfile, SEASONS_MASTER_DATA } from "@/lib/analyzePersonalColor.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Ruler, Sun, Camera, X as XIcon, Compass, ShieldCheck, Loader2, Info, Lightbulb, Shirt, FlaskConical, ChevronDown, Archive } from "lucide-react";
import { ColorDossierSection } from "@/components/studio/style-profile";
import { FACE_SHAPES as HOLISTIC_FACE_SHAPES, HAIR_TYPES as HOLISTIC_HAIR_TYPES } from "@/lib/profile.functions";
import { motion, AnimatePresence } from "framer-motion";


// ---- Developer Telemetry Types (Two-Pass Pipeline Diagnostics) -----
export type StudioTelemetry = {
  pass1Raw: { ambientLighting: string; biologicalUndertone: string; computedContrast: string };
  interceptTriggered: boolean;
  gatekeeperNotes: string[];
  pass2OverrideInputs: {
    ambientLighting: string;
    biologicalUndertone: string;
    computedContrast: string;
    sensorClippingEvent: boolean;
  };
  forcedDiagnostic: boolean;
  source?: "live" | "stress-test" | "manual";
};
import { Check, CheckCircle2, Circle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  Season, MOOD_COLLECT_DEFAULT, type DetailedColorProfile as StudioDossier, type Swatch,
  SEASON_HEX_MATRIX, matrixForSubSeason
} from "./style-profile-constants";

type Hue = "Warm" | "Cool";
type Value = "Light" | "Deep";
type Chroma = "Bright" | "Muted";
type AestheticPersona = string;

const SEASON_PALETTES: Record<Season, { tagline: string }> = {
  Spring: { tagline: "Warm, luminous clarity — sunlit honey, fresh coral, lifted apricot." },
  Summer: { tagline: "Cool, ash-filtered softness — dusty rose, fog blue, mineral lilac." },
  Autumn: { tagline: "Warm, grounded saturation — burnished gold, terracotta, deep olive." },
  Winter: { tagline: "Cool, high-pigment clarity — true crimson, ink navy, glacial white." },
};

const SEASON_EDUCATION: Record<Season, string> = {
  Spring: "Spring complexions glow under warm, light-filled palettes. Embrace clarity over darkness, and let sun-kissed pastels lift your features.",
  Summer: "Summer skin reads best in cool, muted, and softly blended tones. Think misted lavender, ash rose, and powder blue.",
  Autumn: "Autumn thrives on rich, earthy depth. Ground yourself in burnished gold, warm olive, and spiced rust.",
  Winter: "Winter demands crisp, high-contrast drama. True jewel tones and stark blacks and whites create unforgettable impact.",
};

const SEASON_DETAIL: Record<Season, { primary: Swatch[]; secondary: Swatch[]; accent: Swatch[]; avoid: string[]; beauty: string[] }> = {
  Spring: {
    primary: [
      { hex: "#FFE5A8", name: "Light Cream" },
      { hex: "#F7B7A3", name: "Peach Pastel" },
      { hex: "#FFE0B2", name: "Milky Apricot" },
      { hex: "#C8E6C9", name: "Soft Mint" }
    ],
    secondary: [
      { hex: "#F5F5F0", name: "Dull Ivory" },
      { hex: "#B0BEC5", name: "Soft Fog Grey" },
      { hex: "#D7CCC8", name: "Chalk Camel" },
      { hex: "#E0F2F1", name: "Clear Ice Aqua" }
    ],
    accent: [
      { hex: "#FF8C61", name: "Warm Coral" },
      { hex: "#4DB6AC", name: "Sage Teal" },
      { hex: "#FFB74D", name: "Pastel Mandarin" }
    ],
    avoid: [
      "High-Contrast Black",
      "Bleached White",
      "Vivid Primaries"
    ],
    beauty: [
      "Hair: Warm Honey Blonde, Soft Chestnut, Golden Brown",
      "Lip: Peach Gloss, Warm Coral Tint, Apricot Balm",
      "Base: No. 21 Warm Dewy Foundation, Luminous BB Cream"
    ]
  },
  Summer: {
    primary: [
      { hex: "#B0BEC5", name: "Fog Blue" },
      { hex: "#D8BFD8", name: "Dusty Lilac" },
      { hex: "#F5F5F0", name: "Soft Ivory" },
      { hex: "#A5D6A7", name: "Powder Sage" }
    ],
    secondary: [
      { hex: "#E0F2F1", name: "Ice Aqua" },
      { hex: "#F8BBD0", name: "Rose Quartz" },
      { hex: "#CFD8DC", name: "Silver Mist" },
      { hex: "#E1BEE7", name: "Muted Orchid" }
    ],
    accent: [
      { hex: "#7986CB", name: "Periwinkle" },
      { hex: "#80CBC4", name: "Seafoam" },
      { hex: "#CE93D8", name: "Soft Amethyst" }
    ],
    avoid: [
      "Orange-Red Saturated Tones",
      "Warm Earth Brown",
      "Neon or Highly Fluorescent Hues"
    ],
    beauty: [
      "Hair: Ash Blonde, Soft Pearl Brown, Cool Espresso",
      "Lip: Dusty Rose, Cool Pink, Mauve Tint",
      "Base: No. 21 Cool Porcelain Foundation, Matte Velvet Finish"
    ]
  },
  Autumn: {
    primary: [
      { hex: "#D4A24C", name: "Burnished Gold" },
      { hex: "#C97B3D", name: "Terracotta" },
      { hex: "#8D6E63", name: "Deep Camel" },
      { hex: "#5B7053", name: "Olive Moss" }
    ],
    secondary: [
      { hex: "#3E2723", name: "Coffee Bean" },
      { hex: "#5D4037", name: "Rich Umber" },
      { hex: "#A1887F", name: "Taupe Stone" },
      { hex: "#D7CCC8", name: "Warm Sand" }
    ],
    accent: [
      { hex: "#BF360C", name: "Burnt Sienna" },
      { hex: "#F9A825", name: "Antique Gold" },
      { hex: "#33691E", name: "Forest Pine" }
    ],
    avoid: [
      "Cool Pastel Pink",
      "Icy Blue Tones",
      "Bright White Near the Face"
    ],
    beauty: [
      "Hair: Rich Auburn, Warm Chocolate, Caramel Highlights",
      "Lip: Brick Red, Warm Berry, Cinnamon Tint",
      "Base: No. 23 Warm Beige Foundation, Satin Finish"
    ]
  },
  Winter: {
    primary: [
      { hex: "#1A237E", name: "Ink Navy" },
      { hex: "#B71C1C", name: "True Crimson" },
      { hex: "#FFFFFF", name: "Glacial White" },
      { hex: "#4A148C", name: "Deep Amethyst" }
    ],
    secondary: [
      { hex: "#212121", name: "Charcoal" },
      { hex: "#C0C0C0", name: "Platinum" },
      { hex: "#000000", name: "Pure Black" },
      { hex: "#880E4F", name: "Burgundy" }
    ],
    accent: [
      { hex: "#00BCD4", name: "Electric Turquoise" },
      { hex: "#E91E63", name: "Fuchsia" },
      { hex: "#FFEA00", name: "Citrine" }
    ],
    avoid: [
      "Muted Beige or Camel",
      "Soft Pastel Orange",
      "Dusty or Washed-Out Tones"
    ],
    beauty: [
      "Hair: Jet Black, Platinum Silver, Cool Ash Brown",
      "Lip: True Red, Fuchsia, Berry Stain",
      "Base: No. 17 - No. 19 Cool Ivory Foundation, Full Coverage Matte"
    ]
  }
};

const AESTHETIC_MOODS: Array<{ id: string; name: string; desc: string; img: string }> = [
  { id: "minimal", name: "Quiet Minimal", desc: "Clean lines, restrained palette, architectural silhouettes.", img: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=200&h=300&fit=crop" },
  { id: "romantic", name: "Soft Romantic", desc: "Flowing fabrics, delicate details, muted florals.", img: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=200&h=300&fit=crop" },
  { id: "edgy", name: "Urban Edge", desc: "Leather, hardware, monochrome, confident structure.", img: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=200&h=300&fit=crop" },
  { id: "preppy", name: "Classic Preppy", desc: "Tailored blazers, crisp shirts, timeless polish.", img: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=200&h=300&fit=crop" },
  { id: "boho", name: "Modern Boho", desc: "Layered textures, earth tones, effortless movement.", img: "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=200&h=300&fit=crop" },
  { id: "glam", name: "Old Hollywood Glam", desc: "Silk, satin, statement accessories, dramatic elegance.", img: "https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=200&h=300&fit=crop" },
];

const BODY_TYPE_INFO: Record<BodyType, { tagline: string; description: string }> = {
  Hourglass: {
    tagline: "Balanced curves with a defined waist.",
    description: "Your shoulders and hips are roughly equal, with a noticeably narrower waist. Emphasize your waistline with fitted styles, wrap dresses, and belted silhouettes. Avoid boxy cuts that hide your natural curve."
  },
  Rectangle: {
    tagline: "A straight, athletic silhouette.",
    description: "Your shoulders, waist, and hips are fairly aligned. Create curves with ruffles, peplum, and structured jackets. High-waisted bottoms and layered tops add dimension to your frame."
  },
  Pear: {
    tagline: "Narrower shoulders, fuller hips.",
    description: "Your hips are wider than your shoulders. Balance your silhouette by drawing attention upward with statement necklines, structured shoulders, and eye-catching tops. A-line skirts work beautifully."
  },
  "Inverted Triangle": {
    tagline: "Broader shoulders, narrower hips.",
    description: "Your shoulders are wider than your hips. Soften the upper body with V-necks and fluid fabrics, while adding volume below with flared pants and A-line skirts."
  },
  Apple: {
    tagline: "Weight centered in the midsection.",
    description: "Your midsection is your fullest area with slimmer legs and hips. Draw the eye upward with empire waists and open necklines, while highlighting your legs with straight or slim-cut trousers."
  }
};

export const Route = createFileRoute("/_authenticated/style-profile")({ component: StyleProfile });

const UNDERTONES = ["Cool", "Warm", "Neutral"] as const;
const SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;
const BODIES = ["Hourglass", "Rectangle", "Pear", "Inverted Triangle", "Apple"] as const;
const FACE_SHAPES = ["Diamond", "Oval", "Round", "Square", "Heart", "Long"] as const;
const CONTRAST_SCALES = ["Low Contrast", "Medium Contrast", "High Contrast"] as const;

const FACE_SHORT_TO_FULL: Record<string, StudioDossier["faceShape"]> = {
  Oval: "Oval Frame",
  Diamond: "Diamond Geometry",
  Square: "Square Frame",
  Round: "Round Frame",
  Heart: "Heart Frame",
  Long: "Long Frame",
};
const FACE_FULL_TO_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(FACE_SHORT_TO_FULL).map(([k, v]) => [v, k])
);
const CONTRAST_SHORT_TO_FULL: Record<string, StudioDossier["contrastScale"]> = {
  "Low Contrast": "Low Contrast",
  "Medium Contrast": "Medium Contrast",
  "High Contrast": "High Contrast",
};
const CONTRAST_FULL_TO_SHORT: Record<string, string> = {
  "Low Contrast": "Low Contrast",
  "Medium Contrast": "Medium Contrast",
  "High Contrast": "High Contrast",
};

function seasonTone(s: Season): StudioDossier["toneType"] {
  return (["Spring", "Autumn"] as Season[]).includes(s)
    ? "Warm Tone (Yellow Base)"
    : "Cool Tone (Blue Base)";
}
function seasonBrightness(s: Season): StudioDossier["brightness"] {
  if (s === "Spring" || s === "Summer") return "High Lightness";
  if (s === "Winter") return "Medium Lightness";
  return "Low Lightness";
}
function seasonSaturation(s: Season): StudioDossier["saturation"] {
  return s === "Winter" ? "High Saturation" : "Low-Mid Saturation";
}

function splitBeauty(b: string, fallback: string): string {
  const idx = b.indexOf(":");
  return idx >= 0 ? b.slice(idx + 1).trim() : (b || fallback);
}

/** Convert the AI/camera StudioColorProfile shape into the canonical DetailedColorProfile. */
function studioToDossier(p: StudioColorProfile, prev?: StudioDossier): StudioDossier {
  const season = p.season as Season;
  return {
    season,
    subSeason: p.subSeason,
    toneType: p.toneType ?? seasonTone(season),
    brightness: p.brightness ?? prev?.brightness ?? seasonBrightness(season),
    saturation: p.saturation ?? prev?.saturation ?? seasonSaturation(season),
    contrastScale: p.contrastScale ?? "Medium Contrast",
    faceShape: p.faceShape ?? "Oval Frame",
    bodyType: p.bodyType ?? prev?.bodyType ?? MOOD_COLLECT_DEFAULT.bodyType,
    primarySwatches: p.primarySwatches,
    secondarySwatches: p.secondarySwatches,
    accentSwatches: prev?.accentSwatches ?? MOOD_COLLECT_DEFAULT.accentSwatches,
    avoidColors: p.avoidColors,
    beautyMap: {
      hair: p.beautyMap?.hair ?? MOOD_COLLECT_DEFAULT.beautyMap.hair,
      lip: p.beautyMap?.lip ?? MOOD_COLLECT_DEFAULT.beautyMap.lip,
      base: p.beautyMap?.base ?? MOOD_COLLECT_DEFAULT.beautyMap.base,
    },
    fabrication: p.fabrication,
    accessories: p.accessories,
    denimRegistry: p.denimRegistry,
    stylistNote: p.stylistNote,
    fullPalette: (p as any).fullPalette ?? matrixForSubSeason(season, p.subSeason),
    calibrationSource: p.detectedLighting === "Manual Studio Calibration" ? "Studio Calibrated" : "AI Vision",
    confidenceScore: typeof p.confidenceScore === "number" ? p.confidenceScore : undefined,
    confidenceLabel: typeof (p as any).confidenceLabel === "string" ? (p as any).confidenceLabel : undefined,
  };
}

/** Detect & normalize whatever sits in profiles.color_profile JSON. */
function normalizeStoredProfile(raw: any): StudioDossier | null {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw.primarySwatches) && Array.isArray(raw.fabrication) && raw.stylistNote) {
    return studioToDossier(raw as StudioColorProfile);
  }
  if (Array.isArray(raw.primarySwatches) && raw.beautyMap) return raw as StudioDossier;
  return null;
}

type MatrixOption = { value: string; title: string; description: string };

const CONTRAST_OPTIONS: MatrixOption[] = [
  { value: "Low Contrast", title: "Low Contrast Index", description: "Your natural hair, eyes, and skin pigment blend together softly in an adjacent, delicate light range. Saturated tones easily overpower your features." },
  { value: "Medium Contrast", title: "Medium Contrast Index", description: "Features sit in measured dialogue — neither blended nor sharply opposed. Balanced palettes carry the canvas without competing for attention." },
  { value: "High Contrast", title: "High Contrast Index", description: "Striking graphic presence. Rich, deep eyes or sharp hair boundaries carve out a bold, magnificent separation from your complexion canvas." },
];

const SEASON_OPTIONS: MatrixOption[] = [
  { value: "Spring", title: "Spring Palette", description: "Your skin radiates under warm, milky-bright pastels. Golden light clears away shadows around the lips and nose instantly." },
  { value: "Summer", title: "Summer Palette", description: "Your skin thrives next to soft, ash-filtered cool tones. Powdery shades erase under-eye circles and give an immediate clean, glass-skin look." },
  { value: "Autumn", title: "Autumn Palette", description: "Your skin warms beautifully against rich, organic earth tones and spiced gold. Saturated amber depths eliminate fatigue marks effortlessly." },
  { value: "Winter", title: "Winter Palette", description: "Your features command sharp, jewel-toned primary clarity. Icy wavelengths separate your jawline crisply from your neck tone." },
];

const BODY_OPTIONS: MatrixOption[] = [
  { value: "Inverted Triangle", title: "Inverted Triangle", description: "A confident shoulder line that softens gently toward the hip." },
  { value: "Hourglass", title: "Hourglass", description: "Shoulders and hips that echo each other, drawn in at the waist." },
  { value: "Pear", title: "Pear", description: "A graceful lower silhouette with a softer shoulder line." },
  { value: "Rectangle", title: "Rectangle", description: "A long, even line from shoulder to hip — clean and architectural." },
  { value: "Apple", title: "Apple", description: "Volume that sits beautifully through the middle, balanced by slim wrists and ankles." },
];

const BEAUTY_PREFERENCE_TAGS = [
  "Dewy Base",
  "Glass Skin",
  "Monochromatic Peach",
  "Minimalist",
  "Bold Lip",
  "Blurred Velvet Finish",
  "Soft Smoke",
  "Editorial Brow",
  "Lacquered Lash",
  "Skin-First",
] as const;

function SyncBadge({ status }: { status: "idle" | "syncing" | "synced" | "error" }) {
  const label =
    status === "syncing" ? "Syncing…" :
    status === "error" ? "Sync Paused" :
    status === "synced" ? "Dossier Synced" :
    "Awaiting Edits";
  const dot =
    status === "syncing" ? "bg-amber-500 animate-pulse" :
    status === "error" ? "bg-red-500" :
    status === "synced" ? "bg-emerald-600" :
    "bg-foreground/30";
  return (
    <div className="hidden sm:flex items-center gap-2 px-3 py-2 backdrop-blur-xl bg-white/40 border border-foreground/10 rounded-full shrink-0">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="text-[9px] uppercase tracking-[0.34em] text-foreground/75">{label}</span>
    </div>
  );
}

function PerspectiveSwitcher({
  value, onChange,
}: { value: "streamlined" | "detailed"; onChange: (v: "streamlined" | "detailed") => void }) {
  const opts: Array<{ id: "streamlined" | "detailed"; label: string }> = [
    { id: "streamlined", label: "Streamlined" },
    { id: "detailed", label: "Detailed Dossier" },
  ];
  return (
    <div className="inline-flex relative p-1 rounded-full backdrop-blur-xl bg-white/45 border border-foreground/10 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]">
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="relative px-5 sm:px-7 py-2.5 text-[10px] uppercase tracking-[0.34em] z-10"
          >
            {active && (
              <motion.span
                layoutId="perspective-pill"
                className="absolute inset-0 rounded-full bg-foreground"
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
              />
            )}
            <span className={`relative ${active ? "text-background" : "text-foreground/55"}`}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DossierField({
  eyebrow, title, caption, children,
}: { eyebrow?: string; title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        {eyebrow && (
          <p className="text-[9px] uppercase tracking-[0.42em] text-[var(--atelier-gold)]">{eyebrow}</p>
        )}
        <h3 className="font-serif text-2xl tracking-tight text-foreground">{title}</h3>
        {caption && (
          <p className="text-[12px] text-muted-foreground leading-relaxed max-w-xl">{caption}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function DossierAccordion({
  value, eyebrow, caption, children, filled, total,
}: { value: string; eyebrow: string; caption: string; children: React.ReactNode; filled?: number; total?: number }) {
  const hasProgress = typeof filled === "number" && typeof total === "number" && total > 0;
  const complete = hasProgress && filled >= total;
  const partial = hasProgress && filled > 0 && filled < total;
  return (
    <AccordionItem
      value={value}
      className="border-[0.5px] border-border bg-white/40 backdrop-blur-xl rounded-none px-5 sm:px-8"
    >
      <AccordionTrigger className="py-6 hover:no-underline">
        <div className="flex items-center justify-between w-full gap-3">
          <div className="flex flex-col items-start text-left gap-1">
            <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--atelier-gold)]">{eyebrow.split(" / ")[0]}</p>
            <h2 className="font-serif text-xl sm:text-2xl tracking-tight text-foreground">
              {eyebrow.split(" / ")[1] ?? eyebrow}
            </h2>
            <p className="text-[11px] text-muted-foreground leading-relaxed max-w-md mt-1">{caption}</p>
          </div>
          {complete && (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" aria-label="Section complete" />
          )}
          {partial && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground shrink-0">
              <Circle className="h-4 w-4" />
              <span className="text-[10px] uppercase tracking-[0.22em]">{filled}/{total}</span>
            </span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-8 pt-2 space-y-8">{children}</AccordionContent>
    </AccordionItem>
  );
}

function PillRow({
  value, options, onSelect,
}: { value: string | null; options: string[]; onSelect: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onSelect(o)}
            className={[
              "group inline-flex items-center gap-2 px-4 py-2.5 border transition-all duration-200",
              "text-[11px] uppercase tracking-[0.22em] rounded-full",
              active
                ? "bg-[var(--atelier-gold-light)] border-[var(--atelier-gold)] text-[#2B2320]"
                : "bg-[#FAF8F5] border-[#EDE8E0] text-[#6B6259] hover:text-[#2B2320] hover:border-[#C9A96E]/40",
            ].join(" ")}
          >
            <span>{o}</span>
          </button>
        );
      })}
    </div>
  );
}

const DISRUPTIVE_TONE_HEX: Record<string, string> = {
  "High-Contrast Black": "#0B0B0F",
  "Bleached White": "#F4F4F0",
  "Vivid Primaries": "#D72638",
  "Harsh Chartreuse": "#B6C24A",
  "Warm Orange": "#D97A3A",
  "Heavy Rust": "#7A3A24",
  "Mustard": "#C9A227",
  "Magenta": "#B23A7A",
  "Pure Black": "#0B0B0F",
  "Black": "#0B0B0F",
  "Pure White": "#F4F4F0",
};

function hexForTone(name: string): string {
  if (DISRUPTIVE_TONE_HEX[name]) return DISRUPTIVE_TONE_HEX[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(DISRUPTIVE_TONE_HEX)) {
    if (lower.includes(k.toLowerCase())) return v;
  }
  return "#8A6F6F";
}

function DisruptiveToneCard({ name, height = 56 }: { name: string; height?: number }) {
  const hex = hexForTone(name);
  return (
    <div
      className="w-full rounded-xl overflow-hidden flex items-stretch border border-destructive/20"
      style={{ backgroundColor: "#FFF0F0", minHeight: height }}
    >
      <div className="w-1/4 shrink-0" style={{ backgroundColor: hex }} />
      <div className="flex-1 flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-[11px] uppercase tracking-[0.22em] text-foreground font-medium leading-tight">
          {name}
        </span>
        <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-destructive/15 text-destructive text-[9px] uppercase tracking-[0.22em] font-semibold">
          Avoid
        </span>
      </div>
    </div>
  );
}

function BeautyPillTray({
  active, onToggle,
}: { active: string[]; onToggle: (tag: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {BEAUTY_PREFERENCE_TAGS.map((tag) => {
        const isActive = active.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggle(tag)}
            className={[
              "inline-flex items-center gap-2 px-4 py-2.5 border rounded-full transition-all duration-200",
              "text-[11px] uppercase tracking-[0.22em]",
              isActive
                ? "bg-[var(--atelier-gold-light)] border-[var(--atelier-gold)] text-[#2B2320]"
                : "bg-[#FAF8F5] border-[#EDE8E0] text-[#6B6259] hover:text-[#2B2320] hover:border-[#C9A96E]/40",
            ].join(" ")}
          >
            <span>{tag}</span>
          </button>
        );
      })}
    </div>
  );
}

type Tone = "Cool" | "Warm" | "Neutral";
type BodyType = "Hourglass" | "Rectangle" | "Pear" | "Inverted Triangle" | "Apple";
type SubModifier = "Deep" | "Light" | "Bright" | "Soft" | "Warm" | "Cool" | null;
type DetailedColorProfile = { season: Season; subSeason: string; modifier: SubModifier; undertone: Tone; selectedAesthetic: string | null; axes: { hue: Hue; value: Value; chroma: Chroma }; inputs: { drape: "Warm" | "Cool"; hairDepth: string; eyeBrightness: string; lightingConfirmed: boolean }; primary: any[]; secondary: any[]; accent: any[]; avoid: string[]; tagline: string; education: string; version: 2; stylistNote?: string; aiConfidence?: number };

function StyleProfile() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ full_name: "", skin_undertone: "", color_season: "", body_type: "", selected_aesthetic: "" });
  const [holistic, setHolistic] = useState<{ face_shape: string | null; hair_type: string | null }>({ face_shape: null, hair_type: null });
  const [quizOpen, setQuizOpen] = useState(false);
  const [bodyQuizOpen, setBodyQuizOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualContrast, setManualContrast] = useState<string>("");
  const [manualSeason, setManualSeason] = useState<string>("");
  const [dossier, setDossier] = useState<StudioDossier>(MOOD_COLLECT_DEFAULT);
  const [hasRealDossier, setHasRealDossier] = useState(false);
  const [profileRevision, setProfileRevision] = useState(0);
  const [dashCalibrateOpen, setDashCalibrateOpen] = useState(false);
  const [telemetry, setTelemetry] = useState<StudioTelemetry | null>(null);
  const [knownTileId, setKnownTileId] = useState<string | null>(null);
  const [confirmingKnown, setConfirmingKnown] = useState(false);
  const portfolioRef = useRef<HTMLDivElement | null>(null);
  const localStudioUpdateRef = useRef(false);

  // --- Dossier 2.0 perspective + auto-save state ---------------------------
  const [viewMode, setViewMode] = useState<"streamlined" | "detailed">("streamlined");
  const [beautyPrefs, setBeautyPrefs] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const lastSavedRef = useRef<string>("");
  const initialLoadedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase.from("profiles").select("*").eq("id", user.id).single().then(({ data }) => {
      if (cancelled) return;
      if (data) {
        const json = (data as any).color_profile as any;
        setForm({
          full_name: data.full_name ?? "",
          // Prefer JSONB color_profile as the single source of truth; fall back to mirror columns.
          skin_undertone: json?.undertone ?? json?.calculatedUndertone ?? data.skin_undertone ?? "",
          color_season: json?.season ?? data.color_season ?? "",
          body_type: json?.bodyType ?? data.body_type ?? "",
          selected_aesthetic: json?.selectedAesthetic ?? "",
        });
        // Top-level columns are the source of truth. If they're null but
        // legacy data exists inside color_profile JSONB, normalize and
        // backfill the top-level columns on this mount.
        const topFace = (data as any).face_shape as string | null;
        const topHair = (data as any).hair_type as string | null;
        const jbFaceRaw = (json?.faceShape ?? null) as string | null;
        const jbHairRaw = (json?.hairType ?? json?.hair_type ?? null) as string | null;
        const FACE_ENUM = ["Oval", "Round", "Square", "Heart", "Diamond", "Oblong"] as const;
        const HAIR_ENUM = ["Straight/Fine", "Wavy", "Curly", "Coily/Textured"] as const;
        const normFace = (raw: string | null): string | null => {
          if (!raw) return null;
          const first = raw.trim().split(/\s+/)[0];
          return FACE_ENUM.find((f) => f.toLowerCase() === first.toLowerCase()) ?? null;
        };
        const normHair = (raw: string | null): string | null => {
          if (!raw) return null;
          const lower = raw.toLowerCase();
          return HAIR_ENUM.find((h) => lower.includes(h.toLowerCase().split("/")[0])) ?? null;
        };
        const resolvedFace = topFace ?? normFace(jbFaceRaw);
        const resolvedHair = topHair ?? normHair(jbHairRaw);
        const needsBackfill =
          (!topFace && resolvedFace) || (!topHair && resolvedHair);
        if (needsBackfill) {
          // eslint-disable-next-line no-console
          console.log("[StyleProfile] backfilling top-level columns from JSONB →", {
            face_shape: resolvedFace,
            hair_type: resolvedHair,
            from: { jbFaceRaw, jbHairRaw },
          });
          void supabase
            .from("profiles")
            .update({
              face_shape: resolvedFace,
              hair_type: resolvedHair,
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", user.id)
            .then(({ error }) => {
              if (error) console.error("[StyleProfile] backfill FAILED", error);
              else console.log("[StyleProfile] backfill OK");
            });
        }
        setHolistic({
          face_shape: resolvedFace,
          hair_type: resolvedHair,
        });
        const bp = (data as any).beauty_preferences;
        if (Array.isArray(bp)) setBeautyPrefs(bp.filter((x): x is string => typeof x === "string"));
        const normalized = normalizeStoredProfile(json);
        if (normalized && !localStudioUpdateRef.current) { setDossier(normalized); setHasRealDossier(true); }
        // Seed the auto-save baseline so we don't immediately re-write the row we just read.
        lastSavedRef.current = JSON.stringify({
          skin_undertone: (json?.undertone ?? json?.calculatedUndertone ?? data.skin_undertone) || null,
          color_season: (json?.season ?? data.color_season) || null,
          body_type: (json?.bodyType ?? data.body_type) || null,
          // Baseline reflects what's effectively in the row after backfill —
          // so the auto-save effect won't immediately re-write the same value,
          // but WILL write if a user changes the pill selection.
          face_shape: resolvedFace,
          hair_type: resolvedHair,
          beauty_preferences: Array.isArray(bp) ? bp.filter((x: unknown) => typeof x === "string") : [],
        });
        // eslint-disable-next-line no-console
        console.log("[StyleProfile] hydrated profile", {
          color_season: (json?.season ?? data.color_season) || null,
          subSeason: json?.subSeason ?? null,
          skin_undertone: (json?.undertone ?? data.skin_undertone) || null,
          body_type: (json?.bodyType ?? data.body_type) || null,
          face_shape: resolvedFace,
          face_shape_source: topFace ? "profiles column" : (resolvedFace ? "color_profile JSONB backfill" : "null"),
          hair_type: resolvedHair,
          hair_type_source: topHair ? "profiles column" : (resolvedHair ? "color_profile JSONB backfill" : "null"),
          beauty_preferences: bp ?? null,
        });
      }
      setLoading(false);
      initialLoadedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [user]);

  async function commitManual(over: { face?: string; contrast?: string; season?: string; body?: string }) {
    const face = over.face ?? FACE_FULL_TO_SHORT[dossier.faceShape] ?? "Oval";
    const contrast = over.contrast ?? manualContrast ?? CONTRAST_FULL_TO_SHORT[dossier.contrastScale] ?? "Medium Contrast";
    const seasonStr = over.season ?? manualSeason ?? dossier.season;
    const bodyStr = over.body ?? form.body_type ?? dossier.bodyType;
    if (!user || !face || !contrast || !seasonStr || !bodyStr) return;
    const season = seasonStr as Season;
    const bodyType = bodyStr as BodyType;
    const detail = SEASON_DETAIL[season];
    const base = hasRealDossier ? dossier : MOOD_COLLECT_DEFAULT;
    const seasonChanged = season !== base.season;
    const next: StudioDossier = {
      ...base,
      season,
      subSeason: seasonChanged ? `${season} · Studio Tuned` : base.subSeason,
      toneType: seasonTone(season),
      brightness: seasonChanged ? seasonBrightness(season) : base.brightness,
      saturation: seasonChanged ? seasonSaturation(season) : base.saturation,
      faceShape: FACE_SHORT_TO_FULL[face] ?? base.faceShape,
      contrastScale: CONTRAST_SHORT_TO_FULL[contrast] ?? base.contrastScale,
      bodyType,
      primarySwatches: seasonChanged ? detail.primary.slice(0, 4) : base.primarySwatches,
      secondarySwatches: seasonChanged ? detail.secondary.slice(0, 4) : base.secondarySwatches,
      accentSwatches: seasonChanged ? detail.accent.slice(0, 3) : base.accentSwatches,
      avoidColors: seasonChanged ? detail.avoid.slice(0, 3) : base.avoidColors,
      beautyMap: seasonChanged
        ? {
            hair: splitBeauty(detail.beauty[0], MOOD_COLLECT_DEFAULT.beautyMap.hair),
            lip: splitBeauty(detail.beauty[1], MOOD_COLLECT_DEFAULT.beautyMap.lip),
            base: splitBeauty(detail.beauty[2], MOOD_COLLECT_DEFAULT.beautyMap.base),
          }
        : base.beautyMap,
      stylistNote: seasonChanged ? SEASON_EDUCATION[season] : base.stylistNote,
    fullPalette: seasonChanged ? matrixForSubSeason(season, `${season} · Studio Tuned`) : base.fullPalette,
    };
    const undertone = (["Spring", "Autumn"] as string[]).includes(season) ? "Warm" : "Cool";
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      color_season: season,
      skin_undertone: undertone,
      body_type: bodyType,
      color_profile: next as any,
      updated_at: new Date().toISOString(),
    } as any);
    if (error) { toast.error(error.message); return; }
    setDossier(next); setHasRealDossier(true);
    setForm((f) => ({ ...f, color_season: season, skin_undertone: f.skin_undertone || undertone, body_type: bodyType }));
    toast.success("Saved. Your look is locked in.");
  }

  function pickContrast(v: string) { setManualContrast(v); void commitManual({ contrast: v }); }
  function pickSeason(v: string) { setManualSeason(v); void commitManual({ season: v }); }
  function pickBody(v: string) { setForm((f) => ({ ...f, body_type: v })); void commitManual({ body: v }); }

  // Frictionless auto-save: debounce updates to profiles whenever the user
  // changes any dossier vector (season, undertone, body, face, hair, beauty).
  useEffect(() => {
    if (!user || !initialLoadedRef.current) return;
    const payload = {
      skin_undertone: form.skin_undertone || null,
      color_season: form.color_season || null,
      body_type: form.body_type || null,
      face_shape: holistic.face_shape,
      hair_type: holistic.hair_type,
      beauty_preferences: beautyPrefs,
    };
    const sig = JSON.stringify(payload);
    if (sig === lastSavedRef.current) return;
    setSyncStatus("syncing");
    const t = window.setTimeout(async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ ...payload, updated_at: new Date().toISOString() } as never)
        .eq("id", user.id);
      if (error) {
        // eslint-disable-next-line no-console
        console.error("[StyleProfile] auto-save FAILED", error, payload);
        setSyncStatus("error");
        return;
      }
      lastSavedRef.current = sig;
      setSyncStatus("synced");
      // Per-field confirmation that the DB write succeeded.
      // eslint-disable-next-line no-console
      console.log("[StyleProfile] auto-save OK →", {
        skin_undertone: payload.skin_undertone,
        color_season: payload.color_season,
        body_type: payload.body_type,
        face_shape: payload.face_shape,
        hair_type: payload.hair_type,
        beauty_preferences: payload.beauty_preferences,
      });
    }, 600);
    return () => window.clearTimeout(t);
  }, [user, form.skin_undertone, form.color_season, form.body_type, holistic.face_shape, holistic.hair_type, beautyPrefs]);

  function toggleBeauty(tag: string) {
    setBeautyPrefs((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  async function handleStudioComplete(p: StudioColorProfile, t?: StudioTelemetry) {
    localStudioUpdateRef.current = true;
    const next = studioToDossier(p, hasRealDossier ? dossier : undefined);
    const undertone = ((["Spring", "Autumn"] as string[]).includes(next.season) ? "Warm" : "Cool");

    if (t) setTelemetry(t);

    setDiagOpen(false);
    setManualOpen(false);
    setQuizOpen(false);
    setBodyQuizOpen(false);
    setDossier({ ...next });
    setHasRealDossier(true);
    setProfileRevision((n) => n + 1);
    setForm((f) => ({
      ...f,
      color_season: next.season,
      skin_undertone: f.skin_undertone || undertone,
      body_type: next.bodyType,
    }));

    if (user) {
      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        color_season: next.season,
        skin_undertone: undertone,
        body_type: next.bodyType,
        color_profile: next as any,
        updated_at: new Date().toISOString(),
      } as any);
      if (error) {
        console.error("Studio profile save error:", error);
        toast.error("Showing your look, but we couldn't save it just now.");
      }
    }

    window.setTimeout(() => {
      portfolioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    toast.success("Your seasonal palette is ready.");
  }

  /** Dashboard-level fine-tune override. Builds a clean StudioColorProfile
   *  straight from SEASONS_MASTER_DATA and re-uses the full studio-complete
   *  pipeline so the dossier, palette, beautyMap, and confidence chip all
   *  re-hydrate together. */
  async function applyDashboardCalibration(key: keyof typeof SEASONS_MASTER_DATA, label: string) {
    const spec = SEASONS_MASTER_DATA[key];
    const profile: StudioColorProfile = {
      ...spec,
      faceShape: dossier.faceShape ?? "Oval Frame",
      bodyType: dossier.bodyType ?? "Hourglass",
      stylistNote: `Chosen by hand · ${label}. Every swatch, beauty note, and color to avoid below is drawn straight from the atelier's ${spec.subSeason} library.`,
      fullPalette: SEASON_HEX_MATRIX[key],
      detectedLighting: "Manual Studio Calibration",
      calculatedUndertone: spec.toneType,
      confidenceScore: 100,
    };
    setDashCalibrateOpen(false);
    await handleStudioComplete(profile);
  }

  async function save() {
    if (!user) return;
    setSaving(true);
    const { data } = await supabase.from("profiles").select("color_profile").eq("id", user.id).single();
    // Rewrite the entire color_profile JSON cleanly — it's the single source of truth.
    const updatedJson = {
      ...(data?.color_profile as any || {}),
      season: form.color_season || null,
      undertone: form.skin_undertone || null,
      bodyType: form.body_type || null,
      selectedAesthetic: form.selected_aesthetic || null,
      version: 2,
    };
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: form.full_name || null,
      skin_undertone: form.skin_undertone || null,
      color_season: form.color_season || null,
      body_type: form.body_type || null,
      color_profile: updatedJson as any,
      updated_at: new Date().toISOString(),
    } as any);
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Your style profile has been updated.");
  }

  return (
    <div className="bg-[#F5F5F0] text-[#6B6259] min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-12 py-10 md:py-20">
      <header className="mb-12 pb-8 border-b-[0.5px] border-border">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="h-px w-8 bg-foreground/60" />
              <p className="atelier-kicker">Digital Style Dossier · Atelier Record</p>
            </div>
            <h1 className="atelier-title mt-4">Your signature blueprint.</h1>
            <p className="text-[11px] uppercase tracking-[0.32em] text-[var(--atelier-gold)] font-semibold mt-4">A living portrait — kept in sync, automatically.</p>
          </div>
          <SyncBadge status={syncStatus} />
        </div>
      </header>
      {loading ? <div className="text-xs tracking-widest text-muted-foreground animate-pulse">Loading your profile…</div> : (
        <>
          <div className="mb-10">
            <PerspectiveSwitcher value={viewMode} onChange={setViewMode} />
          </div>
          {form.color_season && (
            <div className="mb-10 space-y-8">
              <ColorDossierSection profile={{ color_season: form.color_season, full_name: form.full_name }} />
            </div>
          )}
          <div className="mb-12">
            <AnimatePresence mode="wait" initial={false}>
              {viewMode === "streamlined" ? (
                <motion.div
                  key="streamlined"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.35 }}
                  className="space-y-10"
                >
                  <DossierField
                    eyebrow="Core · 01"
                    title="Color Season"
                    caption="Anchor your palette — sub-season nuance lives in Calibration below."
                  >
                    <PillRow
                      value={form.color_season}
                      options={SEASONS as unknown as string[]}
                      onSelect={(v) => setForm((f) => ({ ...f, color_season: v }))}
                    />
                  </DossierField>
                  <DossierField
                    eyebrow="Core · 02"
                    title="Body Silhouette"
                    caption="Drives every cut, drape, and proportion recommendation."
                  >
                    <PillRow
                      value={form.body_type}
                      options={BODIES as unknown as string[]}
                      onSelect={(v) => setForm((f) => ({ ...f, body_type: v }))}
                    />
                  </DossierField>
                  <DossierField
                    eyebrow="Core · 03"
                    title="Hair Texture"
                    caption="Shapes the silhouette of every hair direction Mila composes."
                  >
                    <PillRow
                      value={holistic.hair_type}
                      options={HOLISTIC_HAIR_TYPES as unknown as string[]}
                      onSelect={(v) => setHolistic((h) => ({ ...h, hair_type: v }))}
                    />
                  </DossierField>
                </motion.div>
              ) : (
                <motion.div
                  key="detailed"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.35 }}
                >
                  <Accordion type="multiple" defaultValue={["01"]} className="space-y-4">
                    <DossierAccordion
                      value="01"
                      eyebrow="01 / The Palette Baseline"
                      caption="Define the chromatic floor that every recommendation refracts through."
                      filled={[form.color_season, form.skin_undertone].filter(Boolean).length}
                      total={2}
                    >
                      <DossierField title="Color Season">
                        <PillRow
                          value={form.color_season}
                          options={SEASONS as unknown as string[]}
                          onSelect={(v) => setForm((f) => ({ ...f, color_season: v }))}
                        />
                      </DossierField>
                      <DossierField title="Skin Undertone">
                        <PillRow
                          value={form.skin_undertone}
                          options={UNDERTONES as unknown as string[]}
                          onSelect={(v) => setForm((f) => ({ ...f, skin_undertone: v }))}
                        />
                      </DossierField>
                    </DossierAccordion>
                    <DossierAccordion
                      value="02"
                      eyebrow="02 / Architectural Frame"
                      caption="The structural vectors — silhouette and facial geometry — that guide every cut."
                      filled={[form.body_type, holistic.face_shape].filter(Boolean).length}
                      total={2}
                    >
                      <DossierField title="Body Silhouette">
                        <PillRow
                          value={form.body_type}
                          options={BODIES as unknown as string[]}
                          onSelect={(v) => setForm((f) => ({ ...f, body_type: v }))}
                        />
                      </DossierField>
                      <DossierField title="Face Shape">
                        <PillRow
                          value={holistic.face_shape}
                          options={HOLISTIC_FACE_SHAPES as unknown as string[]}
                          onSelect={(v) => setHolistic((h) => ({ ...h, face_shape: v }))}
                        />
                      </DossierField>
                    </DossierAccordion>
                    <DossierAccordion
                      value="03"
                      eyebrow="03 / Beauty & Texture"
                      caption="Cosmetic finishes and hair texture — the close-up signature beneath the silhouette."
                      filled={(holistic.hair_type ? 1 : 0) + (beautyPrefs.length > 0 ? 1 : 0)}
                      total={2}
                    >
                      <DossierField title="Hair Texture">
                        <PillRow
                          value={holistic.hair_type}
                          options={HOLISTIC_HAIR_TYPES as unknown as string[]}
                          onSelect={(v) => setHolistic((h) => ({ ...h, hair_type: v }))}
                        />
                      </DossierField>
                      <DossierField title="Beauty Preferences" caption="Tap to toggle the finishes you gravitate toward.">
                        <BeautyPillTray active={beautyPrefs} onToggle={toggleBeauty} />
                      </DossierField>
                    </DossierAccordion>
                  </Accordion>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="mb-10">
            {/* Option 1 — Known Color Profile */}
            <div className="bg-card rounded-[20px] border border-border shadow-[0_4px_24px_rgba(43,35,28,0.07),0_1px_4px_rgba(43,35,28,0.04)] p-6 sm:p-8">
              <div className="text-center">
                      <p className="atelier-kicker">Path 01 · Know Your Season</p>
                <h2 className="font-serif text-2xl sm:text-3xl tracking-tight mt-2">Select Your Known Color Profile</h2>
                <p className="text-xs text-muted-foreground leading-relaxed mt-2 max-w-md mx-auto">
                  Already know your seasonal palette? Tap your look below and confirm — your palette loads instantly, no camera needed.
                </p>
              </div>
              <div className="mt-8 space-y-7">
                {KNOWN_SEASON_GROUPS.map((group) => (
                  <div key={group.season}>
                    <div className="flex items-center gap-3">
                      <span className="h-px w-6 bg-foreground/30" />
                      <p className="text-[10px] uppercase tracking-[0.42em] text-foreground/70">{group.season}</p>
                      <span className="h-px flex-1 bg-foreground/10" />
                    </div>
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {group.tiles.map((tile) => {
                        const active = knownTileId === tile.id;
                        const groupTint: Record<string, string> = {
                          Spring: "#FFF5F0",
                          Summer: "#F5F0FF",
                          Autumn: "#FFF8F0",
                          Winter: "#F0F5FF",
                        };
                        return (
                          <button
                            key={tile.id}
                            type="button"
                            onClick={() => setKnownTileId(tile.id)}
                            style={active ? undefined : { backgroundColor: groupTint[group.season] }}
                            className={`group text-left border px-3 py-3 transition-all min-h-[68px] ${
                              active
                                ? "border-foreground bg-foreground/[0.04] -translate-y-[1px] shadow-[0_0_0_1px_hsl(var(--foreground))]"
                                : "border-border hover:border-foreground/40"
                            }`}
                          >
                            <p className="text-[11px] uppercase tracking-[0.22em] text-foreground flex items-center justify-between gap-2">
                              <span>{tile.label}</span>
                              {active && <Check className="h-3 w-3" />}
                            </p>
                            <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
                              {SEASONS_MASTER_DATA[tile.key].subSeason}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex flex-col items-center">
                <Button
                  disabled={!knownTileId || confirmingKnown}
                  className="w-full sm:w-auto text-xs uppercase tracking-widest h-11 px-8 rounded-none bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
                  onClick={async () => {
                    if (!knownTileId) return;
                    const tile = KNOWN_SEASON_GROUPS.flatMap((g) => g.tiles).find((t) => t.id === knownTileId);
                    if (!tile) return;
                    setConfirmingKnown(true);
                    try {
                      await applyDashboardCalibration(tile.key, tile.label);
                    } finally {
                      setConfirmingKnown(false);
                    }
                  }}
                >
                  {confirmingKnown ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-2" />}
                  Confirm Selection
                </Button>
                <p className="mt-3 text-[10px] uppercase tracking-[0.28em] text-[var(--atelier-gold)] text-center">
                  {knownTileId ? "Loads from our atelier library · Saved to your profile" : "Select a season above to confirm."}
                </p>
              </div>
            </div>

            {/* Option 2 — Studio Camera Calibration */}
            <div className="mt-8">
              <Accordion type="single" collapsible className="bg-card rounded-[20px] border border-border shadow-[0_4px_24px_rgba(43,35,28,0.07),0_1px_4px_rgba(43,35,28,0.04)]">
                <AccordionItem value="studio-camera" className="border-b-0">
                  <AccordionTrigger className="px-6 sm:px-8 py-5 hover:no-underline">
                    <div className="flex flex-col items-start text-left">
                      <p className="atelier-kicker">Path 02 · Discover Your Season</p>
                      <p className="font-serif text-lg sm:text-xl tracking-tight mt-1">Not sure of your season? Let's find it together.</p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                        Find your light, then I'll read your true tones live.
                      </p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-6 sm:px-8 pb-8">
                    <div className="flex flex-col items-center text-center pt-2">
                      <Button
                        className="w-full sm:w-auto text-xs uppercase tracking-widest h-11 px-8 rounded-none bg-foreground text-background hover:bg-foreground/90"
                        onClick={() => setDiagOpen(true)}
                      >
                        <Camera className="h-3.5 w-3.5 mr-2" />
                        Open the camera
                      </Button>
                      <button
                        onClick={() => setManualOpen((v) => !v)}
                        className="mt-4 text-[10px] uppercase tracking-[0.28em] text-[var(--atelier-gold)] hover:text-foreground transition-colors underline-offset-4 hover:underline"
                      >
                        {manualOpen ? "Hide manual override" : "Or set your season by hand"}
                      </button>
                    </div>
                    {manualOpen && (
              <div className="mt-6 animate-fade-in space-y-8 px-1 sm:px-2">
                <div className="bg-card p-8 rounded-[20px] border border-border shadow-[0_4px_24px_rgba(43,35,28,0.07),0_1px_4px_rgba(43,35,28,0.04)] max-w-2xl mx-auto space-y-8">
                  <div className="text-center space-y-2">
                    <span className="text-[0.18em] uppercase tracking-[0.3em] text-stone text-xs block">Private Consultation</span>
                    <h3 className="font-serif text-2xl text-ink tracking-wide">Determine Your Seasonal Palette</h3>
                    <p className="text-sm text-stone max-w-md mx-auto">
                      Aligning the natural undertones of your skin, hair, and eyes with curated textile seasons.
                    </p>
                  </div>
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <label className="text-xs uppercase tracking-[0.2em] text-ink font-medium block">
                        Your Prevailing Season
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { id: 'Spring', title: 'The Spring Awakening', desc: 'Warm, luminous, clear, vivid gold undertones' },
                          { id: 'Summer', title: 'The Muted Summer', desc: 'Cool, soft, ethereal, delicate slate and rose hues' },
                          { id: 'Autumn', title: 'The Rich Autumn', desc: 'Deep, warm, earthy, sun-drenched ochre tones' },
                          { id: 'Winter', title: 'The Vivid Winter', desc: 'Sharp, cool, striking contrast, clear jewel profiles' },
                        ].map((season) => {
                          const active = manualSeason === season.id;
                          return (
                            <button
                              key={season.id}
                              type="button"
                              onClick={() => pickSeason(season.id)}
                              className={`p-4 text-left rounded-xl border transition-all duration-300 group ${active ? 'bg-white border-stone/40 shadow-atelier-soft' : 'border-stone/10 bg-porcelain/30 hover:bg-white hover:border-stone/30 hover:shadow-atelier-soft'}`}
                            >
                              <span className="font-serif text-base text-ink block group-hover:text-rose transition-colors">
                                {season.title}
                              </span>
                              <span className="text-xs text-stone mt-1 block leading-relaxed">
                                {season.desc}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-3 pt-4 border-t border-porcelain/40">
                      <label className="text-xs uppercase tracking-[0.2em] text-ink font-medium block">
                        The Depth of Contrast
                      </label>
                      <p className="text-xs text-stone mb-2">The relationship between the intensity of your features and textiles.</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'Low Contrast', name: 'Soft & Blended', sub: 'Subtle transitions' },
                          { id: 'Medium Contrast', name: 'Balanced Depth', sub: 'Classic equilibrium' },
                          { id: 'High Contrast', name: 'Striking Contrast', sub: 'High-drama definition' },
                        ].map((contrast) => {
                          const active = manualContrast === contrast.id;
                          return (
                            <button
                              key={contrast.id}
                              type="button"
                              onClick={() => pickContrast(contrast.id)}
                              className={`p-3 text-center rounded-lg border transition-all duration-300 ${active ? 'bg-white border-stone/40 shadow-atelier-soft' : 'border-stone/10 bg-porcelain/20 hover:bg-white'}`}
                            >
                              <span className="text-xs uppercase tracking-wider font-semibold text-ink block">{contrast.name}</span>
                              <span className="text-[10px] text-stone mt-0.5 block">{contrast.sub}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                <CardMatrix
                  label="Your silhouette"
                  value={form.body_type}
                  onPick={pickBody}
                  options={BODY_OPTIONS}
                />
              </div>
            )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
          {quizOpen && <ColorQuiz onClose={() => setQuizOpen(false)} onComplete={({ season, undertone, profile }) => setForm((f) => ({ ...f, skin_undertone: undertone, color_season: season, selected_aesthetic: profile.selectedAesthetic || f.selected_aesthetic }))} userId={user?.id} />}
          {bodyQuizOpen && <BodyTypeQuiz onClose={() => setBodyQuizOpen(false)} onComplete={(bodyType) => setForm((f) => ({ ...f, body_type: bodyType }))} userId={user?.id} />}
          {diagOpen && (
            <VisualDiagnosticViewfinder
              onClose={() => setDiagOpen(false)}
              onComplete={handleStudioComplete}
            />
          )}
          <div ref={portfolioRef}>
            <StudioPortfolioView key={hasRealDossier ? `live-${profileRevision}-${dossier.season}-${dossier.subSeason}` : "demo"} profile={dossier} isDemo={!hasRealDossier} telemetry={telemetry} />
          </div>
          {hasRealDossier && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <span className="h-px w-10 bg-foreground/20" />
              <button
                type="button"
                onClick={() => setDashCalibrateOpen(true)}
                className="text-[10px] uppercase tracking-[0.42em] text-[var(--atelier-gold)] hover:text-foreground transition-colors underline-offset-[6px] hover:underline"
              >
                Fine-tune your palette
              </button>
              <span className="h-px w-10 bg-foreground/20" />
            </div>
          )}
          <Sheet open={dashCalibrateOpen} onOpenChange={setDashCalibrateOpen}>
            <SheetContent
              side="bottom"
              className="bg-[#0B0B0B] text-white border-t border-white/10 rounded-t-2xl max-h-[85vh] overflow-y-auto"
            >
              <SheetHeader className="text-left">
                <p className="text-[9px] uppercase tracking-[0.42em] text-white/50">
                  Seoul Atelier
                </p>
                <SheetTitle className="font-serif text-2xl tracking-tight text-white">
                  Already know your seasonal palette? Choose your look below.
                </SheetTitle>
                <SheetDescription className="text-[11px] text-white/60 leading-relaxed">
                  Cameras can read light and shadow differently than the eye. Tap your true sub-season — your palette, beauty notes, and colors to avoid will update from the atelier library, and your confidence chip will lock to 100% Studio Tuned.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-7 pb-6">
                {MANUAL_SEASON_GROUPS.map((group) => (
                  <div key={group.season}>
                    <div className="flex items-center gap-3">
                      <span className="h-px w-6 bg-white/30" />
                      <p className="text-[10px] uppercase tracking-[0.38em] text-white/70">{group.season}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {group.keys.map((k) => {
                        const active = dossier.season === group.season && SEASONS_MASTER_DATA[k.key].subSeason === dossier.subSeason;
                        return (
                          <button
                            key={k.key}
                            type="button"
                            onClick={() => void applyDashboardCalibration(k.key, k.label)}
                            className={`group text-left border px-4 py-3 transition-colors ${
                              active
                                ? "border-white bg-white/[0.10]"
                                : "border-white/15 hover:border-white/60 bg-white/[0.02] hover:bg-white/[0.06]"
                            }`}
                          >
                            <p className="text-[11px] uppercase tracking-[0.22em] text-white flex items-center justify-between gap-2">
                              {k.label}
                              {active && <Check className="h-3 w-3 text-white/80" />}
                            </p>
                            <p className="mt-1 text-[10px] text-white/55 leading-relaxed line-clamp-2">
                              {SEASONS_MASTER_DATA[k.key].subSeason}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[]; }) {
  return (
    <div className="space-y-2"><Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger className="rounded-none h-10"><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger><SelectContent>{options.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}</SelectContent></Select></div>
  );
}

function CardMatrix({ label, value, onPick, options }: { label: string; value: string; onPick: (v: string) => void; options: MatrixOption[] }) {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--atelier-gold)] whitespace-nowrap">{label}</p>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onPick(o.value)}
              className={`group relative text-left rounded-[20px] p-5 sm:p-6 min-h-[120px] transition-all duration-300 bg-card hover:bg-card shadow-[0_4px_24px_rgba(43,35,28,0.07),0_1px_4px_rgba(43,35,28,0.04)] ${
                active
                  ? "border border-foreground bg-foreground/[0.04] shadow-[0_0_0_1px_hsl(var(--foreground))] -translate-y-[1px]"
                  : "border border-transparent hover:border-foreground/20"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className={`text-[12px] uppercase tracking-[0.26em] ${active ? "text-foreground" : "text-foreground/85"}`}>{o.title}</p>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{o.description}</p>
                </div>
                <span className={`mt-0.5 h-5 w-5 shrink-0 rounded-full flex items-center justify-center transition-all ${active ? "bg-foreground text-background scale-100" : "border-[0.5px] border-border scale-90 opacity-60"}`}>
                  {active && <Check className="h-3 w-3" />}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ColorQuiz({ onClose, onComplete, userId }: { onClose: () => void; onComplete: (r: any) => void; userId?: string; }) {
  const [step, setStep] = useState(0);
  const [lightingConfirmed, setLightingConfirmed] = useState(false);
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
    const season: Season = hue === "Warm" ? (value === "Light" ? "Spring" : "Autumn") : (value === "Light" ? "Summer" : "Winter");
    const detail = SEASON_DETAIL[season];
    const profile: DetailedColorProfile = { season, subSeason: `${chroma === "Muted" ? "Soft" : "Bright"} ${season}`, modifier: null, undertone: hue, selectedAesthetic: finalAesthetic, axes: { hue, value, chroma }, inputs: { drape, hairDepth, eyeBrightness, lightingConfirmed }, primary: detail.primary, secondary: detail.secondary, accent: detail.accent, avoid: detail.avoid, tagline: SEASON_PALETTES[season].tagline, education: SEASON_EDUCATION[season], version: 2 };
    if (userId) { setSaving(true); await supabase.from("profiles").upsert({ id: userId, skin_undertone: hue, color_season: season, color_profile: profile as any, updated_at: new Date().toISOString() } as any); setSaving(false); }
    setSelectedAesthetic(finalAesthetic);
    setResult(profile); onComplete({ hue, value, chroma, season, undertone: hue, profile });
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-0 sm:p-4">
      <div className="bg-card w-full sm:border sm:border-border max-w-2xl h-full sm:h-auto sm:max-h-[92vh] overflow-y-auto flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b-[0.5px] border-border flex items-center justify-between shrink-0"><p className="text-[10px] uppercase tracking-[0.25em] text-[var(--atelier-gold)]">Color Quiz · Step {step + 1} of 8</p><button onClick={onClose} className="text-xs font-serif uppercase tracking-wider text-muted-foreground hover:text-foreground">Close</button></div>
        <div className="p-6 md:p-10 flex-1 overflow-y-auto">
          {result ? <DetailedColorResultView profile={result} onClose={onClose} /> : step === 0 ? <LightingStep onConfirm={() => setStep(1)} /> : step === 1 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight leading-snug">Let's find your underlying warmth.<br/>Which colors feel most natural against your skin?</h3>
              <div className="flex flex-col gap-4">
                <button onClick={() => { setHue("Warm"); setStep(2); }} className="w-full text-left border-[0.5px] border-border rounded-none overflow-hidden transition-all hover:border-foreground/40">
                  <div className="h-28 w-full flex"><div className="h-full w-1/2 bg-[#D4A24C]" /><div className="h-full w-1/2 bg-[#C97B3D]" /></div>
                  <div className="p-4"><p className="text-xs uppercase font-medium tracking-widest">Warm Gold Tones</p><p className="text-xs text-muted-foreground mt-1">Gold jewelry feels effortless on you, and warm sunlit hues bring your skin to life.</p></div>
                </button>
                <button onClick={() => { setHue("Cool"); setStep(2); }} className="w-full text-left border-[0.5px] border-border rounded-none overflow-hidden transition-all hover:border-foreground/40">
                  <div className="h-28 w-full flex"><div className="h-full w-1/2 bg-[#C0C0C0]" /><div className="h-full w-1/2 bg-[#5B6A8A]" /></div>
                  <div className="p-4"><p className="text-xs uppercase font-medium tracking-widest">Cool Platinum Tones</p><p className="text-xs text-muted-foreground mt-1">Silver and crisp whites flatter your features, leaving your skin looking fresh and clear.</p></div>
                </button>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight leading-snug">A quick drape test.<br/>Which swatch softens shadows around your eyes?</h3>
              <div className="flex flex-col gap-4">
                <button onClick={() => { setDrape("Cool"); setStep(3); }} className="w-full text-left border-[0.5px] border-border overflow-hidden rounded-none transition-all hover:border-foreground/40">
                  <div className="h-32 w-full bg-[#1E3A8A]" />
                  <div className="p-4"><p className="text-xs uppercase font-medium tracking-widest">Royal Cobalt — cool</p><p className="text-xs text-muted-foreground mt-1">If this deep blue makes you look more rested and refreshed, you lean cool.</p></div>
                </button>
                <button onClick={() => { setDrape("Warm"); setStep(3); }} className="w-full text-left border-[0.5px] border-border overflow-hidden rounded-none transition-all hover:border-foreground/40">
                  <div className="h-32 w-full bg-[#C2410C]" />
                  <div className="p-4"><p className="text-xs uppercase font-medium tracking-widest">Burnt Rust — warm</p><p className="text-xs text-muted-foreground mt-1">If this rich amber smooths and warms your skin, you lean warm.</p></div>
                </button>
              </div>
            </div>
          ) : step === 3 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight leading-snug">Now look at your natural contrast.<br/>How do your features sit against your skin?</h3>
              <div className="flex flex-col gap-3">
                <button onClick={() => { setValue("Light"); setStep(4); }} className="border-[0.5px] border-border p-5 text-left rounded-none transition-all hover:border-foreground/40"><p className="text-xs uppercase font-medium tracking-widest">Soft, low contrast</p><p className="text-xs text-muted-foreground mt-1">Your hair, eyes and skin blend gently together, sitting within a softer overall range.</p></button>
                <button onClick={() => { setValue("Deep"); setStep(4); }} className="border-[0.5px] border-border p-5 text-left rounded-none transition-all hover:border-foreground/40"><p className="text-xs uppercase font-medium tracking-widest">Striking, high contrast</p><p className="text-xs text-muted-foreground mt-1">Rich, darker eyes or hair stand out clearly and beautifully against your complexion.</p></button>
              </div>
            </div>
          ) : step === 4 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight text-center">What is your natural hair depth?</h3>
              <div className="flex flex-col gap-2">
                {["Light blonde or golden amber", "Medium auburn or chestnut brown", "Deep espresso or soft jet black"].map((h) => <button key={h} onClick={() => { setHairDepth(h); setStep(5); }} className="border-[0.5px] border-border p-4 text-xs font-medium uppercase tracking-wider text-left rounded-none hover:bg-foreground/[0.02] transition-all">{h}</button>)}
              </div>
            </div>
          ) : step === 5 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight leading-snug">Look closely at your eyes.<br/>How would you describe your iris?</h3>
              <div className="grid grid-cols-1 gap-3">
                <button onClick={() => { setEyeBrightness("Bright"); setStep(6); }} className="border-[0.5px] border-border p-5 text-left rounded-none transition-all hover:border-foreground/40"><p className="text-xs uppercase font-medium tracking-widest">Glassy and jewel-like</p><p className="text-xs text-muted-foreground mt-1">A clear contrast between the whites and the iris — luminous amber, crisp blue, or vivid hazel.</p></button>
                <button onClick={() => { setEyeBrightness("Soft"); setStep(6); }} className="border-[0.5px] border-border p-5 text-left rounded-none transition-all hover:border-foreground/40"><p className="text-xs uppercase font-medium tracking-widest">Smoky and softly blended</p><p className="text-xs text-muted-foreground mt-1">Your iris blends gently — perhaps muted grey-blue, deep rich brown, or soft dusty olive.</p></button>
              </div>
            </div>
          ) : step === 6 ? (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight leading-snug">A quick saturation check.<br/>Which tones bring out your natural presence?</h3>
              <div className="flex flex-col gap-4">
                <button onClick={() => { setChroma("Bright"); setStep(7); }} className="w-full text-left border-[0.5px] border-border rounded-none p-4 transition-all hover:border-foreground/40">
                  <div className="flex gap-1.5 mb-3"><div className="h-6 w-full bg-[#E0144C]" /><div className="h-6 w-full bg-[#00BFFF]" /><div className="h-6 w-full bg-[#FF1493]" /></div>
                  <p className="text-xs uppercase font-medium tracking-widest">Clear and vibrant</p><p className="text-xs text-muted-foreground mt-1">Pure, energetic, fully saturated colors make you stand out instantly.</p>
                </button>
                <button onClick={() => { setChroma("Muted"); setStep(7); }} className="w-full text-left border-[0.5px] border-border rounded-none p-4 transition-all hover:border-foreground/40">
                  <div className="flex gap-1.5 mb-3"><div className="h-6 w-full bg-[#7E97AB]" /><div className="h-6 w-full bg-[#B58867]" /><div className="h-6 w-full bg-[#5B7053]" /></div>
                  <p className="text-xs uppercase font-medium tracking-widest">Powdered and earthy</p><p className="text-xs text-muted-foreground mt-1">Muted velvets, dusted sages, and smoke-kissed hues look quietly elevated on you.</p>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl tracking-tight text-center">Choose your signature aesthetic:</h3>
              <div className="grid grid-cols-1 gap-2 max-h-[50vh] overflow-y-auto">
                {AESTHETIC_MOODS.map((m) => <button key={m.id} disabled={saving} onClick={() => { setSelectedAesthetic(m.id); complete(m.id); }} className="border-[0.5px] border-border p-3 flex gap-4 items-center text-left rounded-none hover:border-foreground/40 transition-all"><img src={m.img} className="h-14 w-11 object-cover filter grayscale" /><div><p className="text-xs uppercase font-medium tracking-wider">{m.name}</p><p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{m.desc}</p></div></button>)}
              </div>
            </div>
          )}
          {step > 0 && !result && <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} className="text-xs uppercase tracking-widest mt-6 rounded-none gap-1"><ArrowLeft className="h-3 w-3" /> Back</Button>}
        </div>
      </div>
    </div>
  );
}

function LightingStep({ onConfirm }: { onConfirm: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="space-y-5">
      <h3 className="font-serif text-2xl flex items-center gap-2 tracking-tight"><Sun className="h-5 w-5" /> Let's find your light</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">Find a spot with soft, natural day lighting so I can see your true tones. Step away from harsh overhead bulbs, yellow lamps, and deep shadows — that's where your undertones come through clearest.</p>
      <label className="flex items-start gap-3 border-[0.5px] border-border p-4 cursor-pointer rounded-none">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-foreground" />
        <span className="text-xs text-muted-foreground leading-relaxed">I'm currently in soft, indirect natural daylight.</span>
      </label>
      <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--atelier-gold)] leading-relaxed">Prefer a live AI scan? Close this quiz and tap <span className="text-foreground">Run Visual Diagnostic</span> on the studio dossier to launch the camera viewfinder.</p>
      <div className="flex justify-end pt-4 border-t-[0.5px] border-border">
        <Button size="sm" className="text-xs uppercase tracking-widest rounded-none h-9 px-6" onClick={onConfirm} disabled={!confirmed}>Continue manually</Button>
      </div>
    </div>
  );
}

function DetailedColorResultView({ profile, onClose }: { profile: DetailedColorProfile; onClose: () => void; }) {
  const detail = SEASON_DETAIL[profile.season];
  return (
    <div className="space-y-8 animate-fade-in text-left max-w-xl mx-auto">
      <div className="text-center border-b-[0.5px] border-border pb-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-foreground text-background text-[9px] uppercase tracking-widest font-medium">
          <ShieldCheck className="h-3.5 w-3.5" /> SEOUL DIGITAL DIAGNOSTIC REUSE
        </div>
        <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--atelier-gold)] mt-5 mb-1">Your Diagnostic Palette</p>
        <h3 className="font-serif text-3xl sm:text-4xl tracking-tight font-medium">{profile.subSeason}</h3>
        <p className="text-[11px] font-sans tracking-wide text-muted-foreground mt-2 leading-relaxed">{profile.education}</p>
        {profile.stylistNote && (
          <div className="mt-5 border-l-2 border-foreground/40 pl-3 text-left max-w-md mx-auto">
            <p className="text-[9px] uppercase tracking-[0.25em] text-[var(--atelier-gold)] mb-1">Stylist Note{typeof profile.aiConfidence === "number" ? ` · ${Math.round(profile.aiConfidence)}% confidence` : ""}</p>
            <p className="font-serif text-sm italic text-foreground leading-relaxed">"{profile.stylistNote}"</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="border-[0.5px] border-border p-3 bg-foreground/[0.01]">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Tone Type</p>
          <p className="font-medium text-xs uppercase mt-0.5">{profile.axes.chroma === "Muted" ? "Soft / Muted Tone" : "Clear / Vivid Tone"}</p>
        </div>
        <div className="border-[0.5px] border-border p-3 bg-foreground/[0.01]">
          <p className="text-[9px] uppercase tracking-wider text-destructive">Grave Color (Worst Tone)</p>
          <p className="font-medium text-xs uppercase mt-0.5 text-destructive/90">Avoid Next to Face</p>
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--atelier-gold)] font-semibold mb-3">I. Best Draping Swatches</p>
        <div className="grid grid-cols-4 gap-2">
          {profile.primary.map((s, i) => (
            <div key={i} className="space-y-1">
              <div className="h-12 border-[0.5px] border-border" style={{ backgroundColor: s.hex }} />
              <p className="text-[9px] uppercase tracking-wide text-[var(--atelier-gold)] truncate">{s.name}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-foreground/10 bg-foreground/[0.02] p-5 space-y-3">
        <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-foreground">II. K-Beauty Studio Prescription</p>
        <ul className="space-y-2">
          {detail.beauty.map((tip, i) => {
            const [label, text] = tip.split(': ');
            return (
              <li key={i} className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground font-medium uppercase text-[10px] tracking-wider block mb-0.5">{label}</strong>
                {text}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border border-destructive/10 bg-destructive/[0.01] p-4">
        <p className="text-[10px] uppercase text-destructive tracking-widest mb-2 flex items-center gap-1"><XIcon className="h-3 w-3" /> Grave Tone Exclusions</p>
        <div className="flex flex-col gap-1.5">
          {profile.avoid.map((a) => (
            <span key={a} className="text-[11px] text-muted-foreground font-sans leading-relaxed flex items-center gap-2">
              <span className="h-1 w-1 bg-destructive/50 shrink-0" /> {a}
            </span>
          ))}
        </div>
      </div>

      <Button onClick={onClose} className="w-full text-xs uppercase tracking-widest h-11 rounded-none bg-foreground text-background">Complete Session Validation</Button>
    </div>
  );
}

type Drape = "structured" | "waist" | "relaxed";
type Balance = "aligned" | "hips" | "upper";

function resolveBodyFromQuiz(drape: Drape, balance: Balance): BodyType {
  // Waist-defined blazers + curve at the hips = clear hourglass / pear story.
  if (drape === "waist") {
    if (balance === "hips") return "Pear";
    return "Hourglass"; // aligned or upper-strong with a defined waist
  }
  // Structured shoulder line.
  if (drape === "structured") {
    if (balance === "hips") return "Hourglass"; // shoulders match a hip curve
    return "Inverted Triangle"; // aligned or upper-strong
  }
  // Relaxed all over.
  if (balance === "hips") return "Pear";
  return "Rectangle";
}

const DRAPE_CHOICES: { value: Drape; label: string; hint: string }[] = [
  { value: "structured", label: "Structured at the shoulders", hint: "The jacket holds its line up top." },
  { value: "waist",      label: "Form-fitting at the waist",   hint: "It draws in just below the ribs." },
  { value: "relaxed",    label: "Relaxed all over",            hint: "It falls in a straight, easy line." },
];

const BALANCE_CHOICES: { value: Balance; label: string; hint: string }[] = [
  { value: "aligned", label: "Shoulders and hips align", hint: "Mirrored top and bottom." },
  { value: "hips",    label: "Curving at the hips",     hint: "More softness through the lower half." },
  { value: "upper",   label: "Stronger upper frame",    hint: "Presence sits across the shoulders." },
];

function BodyTypeQuiz({ onClose, onComplete, userId }: { onClose: () => void; onComplete: (bodyType: BodyType) => void; userId?: string; }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [drape, setDrape] = useState<Drape | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [saving, setSaving] = useState(false);

  const result: BodyType | null = drape && balance ? resolveBodyFromQuiz(drape, balance) : null;

  async function commit() {
    if (!result) return;
    if (userId) {
      setSaving(true);
      await supabase.from("profiles").upsert({ id: userId, body_type: result, updated_at: new Date().toISOString() } as any);
      setSaving(false);
    }
    onComplete(result);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-0 sm:p-4">
      <div className="bg-card w-full sm:border sm:border-border max-w-xl h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto p-6 sm:p-8 flex flex-col shadow-2xl">
        <div className="flex justify-between items-center pb-4 mb-6 border-b border-border/60">
          <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--atelier-gold)]">
            Step {step} of 3 · Find your silhouette
          </p>
          <button onClick={onClose} className="text-[10px] uppercase tracking-widest text-[var(--atelier-gold)] hover:text-foreground transition-colors">Close</button>
        </div>

        {step === 1 && (
          <div className="space-y-5 animate-fade-in">
            <div className="text-center">
              <h3 className="font-serif text-2xl sm:text-3xl tracking-tight">How do your favorite blazers drape?</h3>
              <p className="text-xs text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">Pick the one that feels most like you when you put on a piece you love.</p>
            </div>
            <div className="space-y-2.5">
              {DRAPE_CHOICES.map((c) => {
                const active = drape === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setDrape(c.value)}
                    className={`w-full text-left border p-4 sm:p-5 rounded-none transition-all ${active ? "border-foreground bg-foreground/[0.04]" : "border-border hover:border-foreground/40"}`}
                  >
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{c.hint}</p>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end pt-2">
              <Button disabled={!drape} onClick={() => setStep(2)} className="text-xs uppercase tracking-widest rounded-none h-10 px-6">
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5 animate-fade-in">
            <div className="text-center">
              <h3 className="font-serif text-2xl sm:text-3xl tracking-tight">Where do you naturally feel most balanced?</h3>
              <p className="text-xs text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">Think of yourself in your favorite jeans and a soft t-shirt.</p>
            </div>
            <div className="space-y-2.5">
              {BALANCE_CHOICES.map((c) => {
                const active = balance === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setBalance(c.value)}
                    className={`w-full text-left border p-4 sm:p-5 rounded-none transition-all ${active ? "border-foreground bg-foreground/[0.04]" : "border-border hover:border-foreground/40"}`}
                  >
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{c.hint}</p>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="text-xs uppercase rounded-none">
                <ArrowLeft className="h-3 w-3 mr-1" /> Back
              </Button>
              <Button disabled={!balance} onClick={() => setStep(3)} className="text-xs uppercase tracking-widest rounded-none h-10 px-6">
                See your silhouette
              </Button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="space-y-5 text-center animate-fade-in">
            <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--atelier-gold)]">Your silhouette</p>
            <h3 className="font-serif text-3xl sm:text-4xl tracking-tight">{result}</h3>
            <p className="text-xs text-muted-foreground italic max-w-sm mx-auto">{BODY_TYPE_INFO[result].tagline}</p>
            <div className="text-left bg-muted/30 p-5 text-xs leading-relaxed text-muted-foreground border border-border rounded-none">
              {BODY_TYPE_INFO[result].description}
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="ghost" onClick={() => { setStep(1); setDrape(null); setBalance(null); }} className="flex-1 text-xs uppercase tracking-widest rounded-none h-11">
                Start over
              </Button>
              <Button onClick={commit} disabled={saving} className="flex-1 text-xs uppercase tracking-widest rounded-none h-11">
                {saving ? "Saving…" : "That's me"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const DRAPE_COLORS = ["#FFB347", "#94A3B8", "#1E3A8A", "#F7B7A3", "#C2410C"] as const;
const DRAPE_LABELS = [
  "READING YOUR TRUE TONES…",
  "FEELING THE WARMTH IN YOUR SKIN…",
  "STUDYING THE CONTRAST IN YOUR FEATURES…",
] as const;

/* Manual studio override — grouped 12 sub-seasons. Tapping bypasses the
   vision pipeline and hydrates state directly from SEASONS_MASTER_DATA. */
const MANUAL_SEASON_GROUPS: { season: Season; keys: { key: keyof typeof SEASONS_MASTER_DATA; label: string }[] }[] = [
  { season: "Spring", keys: [
    { key: "SPRING_LIGHT",  label: "Spring Light" },
    { key: "SPRING_BRIGHT", label: "Spring Bright" },
    { key: "SPRING_WARM",   label: "Spring Warm" },
  ]},
  { season: "Summer", keys: [
    { key: "SUMMER_LIGHT", label: "Summer Light" },
    { key: "SUMMER_MUTED", label: "Summer Muted" },
    { key: "SUMMER_COOL",  label: "Summer Cool" },
  ]},
  { season: "Autumn", keys: [
    { key: "AUTUMN_SOFT",  label: "Autumn Soft" },
    { key: "AUTUMN_TRUE",  label: "Autumn True" },
    { key: "AUTUMN_DEEP",  label: "Autumn Deep" },
    { key: "AUTUMN_WARM",  label: "Autumn Warm" },
  ]},
  { season: "Winter", keys: [
    { key: "WINTER_DEEP",   label: "Winter Deep" },
    { key: "WINTER_CLEAR",  label: "Winter Clear" },
    { key: "WINTER_TRUE",   label: "Winter True" },
    { key: "WINTER_COOL",   label: "Winter Cool" },
  ]},
];

/**
 * KNOWN_SEASON_GROUPS — 16-season presentation layer mapped onto our 12
 * canonical PCCS hydration keys. Some labels (e.g. Spring True / Spring Warm)
 * share the same underlying key because the certified atelier dictionary
 * stores 12 master matrices.
 */
const KNOWN_SEASON_GROUPS: { season: Season; tiles: { id: string; label: string; key: keyof typeof SEASONS_MASTER_DATA }[] }[] = [
  { season: "Spring", tiles: [
    { id: "spring-light",  label: "Light Spring",  key: "SPRING_LIGHT"  },
    { id: "spring-true",   label: "True Spring",   key: "SPRING_TRUE"   },
    { id: "spring-bright", label: "Bright Spring", key: "SPRING_BRIGHT" },
    { id: "spring-warm",   label: "Warm Spring",   key: "SPRING_WARM"   },
  ]},
  { season: "Summer", tiles: [
    { id: "summer-light",  label: "Light Summer",  key: "SUMMER_LIGHT" },
    { id: "summer-true",   label: "True Summer",   key: "SUMMER_TRUE"  },
    { id: "summer-muted",  label: "Muted Summer",  key: "SUMMER_MUTED" },
    { id: "summer-cool",   label: "Cool Summer",   key: "SUMMER_COOL"  },
  ]},
  { season: "Autumn", tiles: [
    { id: "autumn-soft",   label: "Soft Autumn",   key: "AUTUMN_SOFT" },
    { id: "autumn-true",   label: "True Autumn",   key: "AUTUMN_TRUE" },
    { id: "autumn-deep",   label: "Deep Autumn",   key: "AUTUMN_DEEP"  },
    { id: "autumn-warm",   label: "Warm Autumn",   key: "AUTUMN_WARM"  },
  ]},
  { season: "Winter", tiles: [
    { id: "winter-clear",  label: "Clear Winter",  key: "WINTER_CLEAR" },
    { id: "winter-true",   label: "True Winter",   key: "WINTER_TRUE"  },
    { id: "winter-deep",   label: "Deep Winter",   key: "WINTER_DEEP"   },
    { id: "winter-cool",   label: "Cool Winter",   key: "WINTER_COOL"   },
  ]},
];

function BriefingRule({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center border-[0.5px] border-white/30 text-white/90">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.32em] text-white">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-white/65">{body}</p>
      </div>
    </li>
  );
}

function VisualDiagnosticViewfinder({ onClose, onComplete }: { onClose: () => void; onComplete: (p: StudioColorProfile, t?: StudioTelemetry) => Promise<void> | void }) {
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
  const [pipelineLog, setPipelineLog] = useState<string[]>([
    "Waiting for the right light…",
  ]);
  const [manualCalibrateOpen, setManualCalibrateOpen] = useState(false);
  const analyze = useServerFn(analyzeStudioColor);

  function pushLog(line: string) {
    setPipelineLog((prev) => [...prev, `[${new Date().toLocaleTimeString([], { hour12: false })}] ${line}`]);
  }

  useEffect(() => {
    if (!calibrated) return;
    let cancelled = false;
    setStreamErr(null);
    pushLog("Opening the camera…");
    if (!navigator?.mediaDevices?.getUserMedia) {
      setStreamErr("Camera Access Restricted. Please verify your browser site settings allow lens access and ensure you are using an HTTPS connection.");
      pushLog("Camera isn't available on this device.");
      return;
    }
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        pushLog("Camera is on. Let's see you.");
      } catch (e: any) {
        const name = e?.name || "";
        if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
          setStreamErr("Camera Access Restricted. Please verify your browser site settings allow lens access and ensure you are using an HTTPS connection.");
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
      // Detach the video element first so the browser releases its reference,
      // then explicitly stop every track so the OS camera indicator turns off.
      if (videoRef.current) {
        try { videoRef.current.pause(); } catch {}
        videoRef.current.srcObject = null;
      }
      const stream = streamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) {
          try { track.stop(); } catch {}
        }
      }
      streamRef.current = null;
    };
  }, [calibrated]);

  useEffect(() => {
    if (!analyzing) return;
    const c = setInterval(() => setDrapeIdx((i) => (i + 1) % DRAPE_COLORS.length), 350);
    const l = setInterval(() => setLabelIdx((i) => (i + 1) % DRAPE_LABELS.length), 1400);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => { clearInterval(c); clearInterval(l); clearInterval(t); };
  }, [analyzing]);

  async function capture(opts?: { stressTest?: boolean }) {
    setAnalyzing(true); setDrapeIdx(0); setLabelIdx(0); setElapsed(0);
    const video = videoRef.current;
    if (!video || video.readyState !== 4 || !video.videoWidth || !video.videoHeight) {
      toast.error("Camera is still warming up. Hold steady for a moment and try again.");
      setAnalyzing(false);
      return;
    }
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvas.width = 400; canvas.height = 400;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) { toast.error("Unable to capture frame."); setAnalyzing(false); return; }
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

  async function runAnalyze(base64: string, opts?: { stressTest?: boolean; source?: "live" | "stress-test" | "upload" }) {
    const sourceLabel = opts?.source ?? (opts?.stressTest ? "stress-test" : "live");
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
        toast.error(result.error || "Let's try that again. Make sure the lighting is clear so I can catch the right tones.");
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
      if (videoRef.current) {
        try { videoRef.current.pause(); } catch {}
        videoRef.current.srcObject = null;
      }
      const stream = streamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) {
          try { track.stop(); } catch {}
        }
      }
      streamRef.current = null;
      await onComplete(profile, telemetry);
    } catch (e: any) {
      console.error("Studio error details:", e);
      toast.error(e?.message || "Let's try that again. Make sure the lighting is clear so I can catch the right tones.");
      pushLog(`Something went wrong: ${e?.message || "unknown"}.`);
      setAnalyzing(false);
    }
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file from your studio archive.");
      return;
    }
    setAnalyzing(true); setDrapeIdx(0); setLabelIdx(0); setElapsed(0);
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

  /** Bypass the vision pipeline. Hydrate StudioColorProfile directly from
   *  the static SEASONS_MASTER_DATA spec and forward to onComplete. */
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
    // Release camera before unmounting via parent state change.
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch {}
      videoRef.current.srcObject = null;
    }
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch {}
      }
    }
    streamRef.current = null;
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

  return (
    !calibrated ? (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b-[0.5px] border-border">
          <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--atelier-gold)]">Seoul Atelier · Find your light</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><XIcon className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-lg border-[0.5px] border-border bg-card text-card-foreground px-7 py-9">
            <p className="text-[9px] uppercase tracking-[0.42em] text-[var(--atelier-gold)] text-center">
              Let's find your light
            </p>
            <h3 className="mt-3 font-serif text-3xl tracking-tight text-center text-foreground">
              Step into natural, indirect daylight
            </h3>
            <div className="my-6 h-px w-12 mx-auto bg-foreground/30" />
            <p className="text-xs text-muted-foreground leading-relaxed text-center">
              Before I open the camera, find a window with soft, indirect daylight — no direct sun, no overhead yellow bulbs. That's how I see your true tones.
            </p>
            <ul className="mt-7 space-y-5">
              <BriefingRule icon={<Sun className="h-4 w-4" />} title="Face the window" body="Natural daylight from the front. No backlight, no direct sun." />
              <BriefingRule icon={<Lightbulb className="h-4 w-4" />} title="Switch off yellow bulbs" body="Warm overhead lamps throw the read off." />
              <BriefingRule icon={<Shirt className="h-4 w-4" />} title="Wear something neutral" body="Saturated tops can cast color onto your skin." />
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
              onClick={() => { pushLog("Light is good. Let's go."); setCalibrated(true); }}
              className="mt-6 w-full h-11 bg-foreground text-background text-[10px] uppercase tracking-[0.32em] hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Open the camera
            </button>
            <p className="mt-4 text-center text-[9px] uppercase tracking-[0.32em] text-[var(--atelier-gold)]">
              Your camera stays off until you're ready.
            </p>
          </div>
        </div>
      </div>
    ) :
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-5 py-4 bg-gradient-to-b from-black/70 to-transparent">
        <span className="text-[10px] uppercase tracking-[0.3em] text-white/90">Seoul Atelier · Studio Camera</span>
        <button onClick={onClose} className="text-white/80 hover:text-white"><XIcon className="h-5 w-5" /></button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
        <canvas ref={canvasRef} className="hidden" />

        {/* Golden oval tracking guide */}
        <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid meet">
          <ellipse cx="50" cy="62" rx="22" ry="34" fill="none" stroke="#D4A24C" strokeWidth="0.35" strokeDasharray="1 1.2" opacity="0.9" />
          <ellipse cx="50" cy="62" rx="22.4" ry="34.4" fill="none" stroke="#D4A24C" strokeWidth="0.08" opacity="0.5" />
        </svg>

        {/* Salon draping cape — guides head & shoulder centering so landmark
            samplers reliably hit the Cheek Apex and Iris roots. */}
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

        {/* Studio Telemetry Logs — collapsible workspace anchored beside the viewfinder */}
        <div className="absolute top-16 right-4 z-30 w-[280px] max-w-[78vw] hidden sm:block">
          <div className="border-[0.5px] border-white/20 bg-black/55 backdrop-blur-md text-white">
            <button
              type="button"
              onClick={() => setTelemetryOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-[9px] uppercase tracking-[0.32em] hover:bg-white/5"
              aria-expanded={telemetryOpen}
            >
              <span className="inline-flex items-center gap-1.5"><FlaskConical className="h-3 w-3" /> Studio notes</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${telemetryOpen ? "rotate-180" : ""}`} />
            </button>
            {telemetryOpen && (
              <pre className="max-h-64 overflow-y-auto px-3 pb-3 pt-0 font-mono text-[9px] leading-relaxed text-white/75 whitespace-pre-wrap break-words">
{pipelineLog.length ? pipelineLog.join("\n") : "Waiting…"}
              </pre>
            )}
          </div>
        </div>

        {streamErr && !analyzing && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 text-center px-8 bg-black/85 text-white">
            <Camera className="h-6 w-6" />
            <p className="text-xs leading-relaxed max-w-xs">{streamErr}</p>
          </div>
        )}

        {analyzing && (
          <div
            className="absolute inset-0 z-40 flex flex-col items-center justify-center transition-colors duration-300"
            style={{ backgroundColor: DRAPE_COLORS[drapeIdx] }}
          >
            <div className="text-center px-8 mix-blend-difference">
              <p className="text-[10px] uppercase tracking-[0.35em] text-white font-medium">{DRAPE_LABELS[labelIdx]}</p>
              <div className="mt-6 h-px w-20 mx-auto bg-white/80" />
              <p className="mt-6 text-[9px] uppercase tracking-[0.4em] text-white/90">Seoul Studio · Reading your tones</p>
              <p className="mt-4 font-serif text-3xl tabular-nums text-white tracking-[0.2em]">
                {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
              </p>
              <p className="mt-1 text-[9px] uppercase tracking-[0.4em] text-white/80">Looking at your photo</p>
            </div>
          </div>
        )}
      </div>

      {/* Luxury minimalist shutter capture button */}
      <div className="absolute bottom-24 inset-x-0 z-20 flex items-center justify-center">
        <button
          onClick={() => capture()}
          disabled={analyzing || !!streamErr}
          className="group relative flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 hover:scale-105 active:scale-95"
          aria-label="Take photo"
        >
          {/* Outer ring */}
          <span className="absolute inset-0 rounded-full border-2 border-white/80 bg-black/10 backdrop-blur-sm" />
          {/* Inner core */}
          <span className="relative flex items-center justify-center h-14 w-14 rounded-full bg-white/90 shadow-sm">
            {analyzing ? (
              <Loader2 className="h-5 w-5 animate-spin text-black/80" />
            ) : null}
          </span>
        </button>
        {/* Developer diagnostic — forces Pass-1 to a hardcoded "Backlit & High
            Contrast" device state so the server-side gatekeeper's contrast
            clamp can be verified without needing the real environment. */}
        <button
          type="button"
          onClick={() => capture({ stressTest: true })}
          disabled={analyzing || !!streamErr}
          className="absolute right-6 inline-flex items-center justify-center h-8 w-8 rounded-full border border-white/30 bg-black/40 text-white/70 hover:text-white hover:border-white/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Try a tricky-light sample"
          title="Sample look · backlit, high contrast"
        >
          <FlaskConical className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Subtle alignment reminder above shutter */}
      {!analyzing && (
        <div className="absolute bottom-44 inset-x-0 z-10 flex justify-center pointer-events-none">
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/70 font-serif italic">
            Align your profile boundaries within the guide
          </p>
        </div>
      )}

      {/* Manual calibration override — sits well below the shutter so it
          never competes with the primary capture ring. */}
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
            <p className="text-[9px] uppercase tracking-[0.42em] text-white/50">
              Seoul Atelier
            </p>
            <SheetTitle className="font-serif text-2xl tracking-tight text-white">
              Already know your seasonal palette? Choose your look below.
            </SheetTitle>
            <SheetDescription className="text-[11px] text-white/60 leading-relaxed">
              Skip the camera and pick your sub-season — your palette, beauty notes, and colors to avoid load straight from the atelier library.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-7 pb-6">
            {MANUAL_SEASON_GROUPS.map((group) => (
              <div key={group.season}>
                <div className="flex items-center gap-3">
                  <span className="h-px w-6 bg-white/30" />
                  <p className="text-[10px] uppercase tracking-[0.38em] text-white/70">{group.season}</p>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {group.keys.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => void applyManualCalibration(k.key, k.label)}
                      className="group text-left border border-white/15 hover:border-white/60 bg-white/[0.02] hover:bg-white/[0.06] px-4 py-3 transition-colors"
                    >
                      <p className="text-[11px] uppercase tracking-[0.22em] text-white">{k.label}</p>
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

function StudioPortfolioView({ profile, isDemo, telemetry }: { profile: StudioDossier; isDemo?: boolean; telemetry?: StudioTelemetry | null }) {
  const faceShort = FACE_FULL_TO_SHORT[profile.faceShape] ?? profile.faceShape;
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const dossierNumber = `${profile.season.slice(0, 2).toUpperCase()}–${faceShort.slice(0, 2).toUpperCase()}`;
  const primaryBlocks = profile.primarySwatches.slice(0, 4);
  const accentBlocks = (profile.accentSwatches && profile.accentSwatches.length > 0
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
      {/* Color-Block Portfolio Header + Palette */}
      <header className="px-6 sm:px-10 pt-10 pb-8 border-b-[0.5px] border-border">
        {/* Chip row */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-foreground text-background text-[9px] uppercase tracking-[0.32em] font-medium">
            <ShieldCheck className="h-3 w-3" /> Seoul Atelier Record
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {telemetry && !isDemo && (
              <button
                type="button"
                onClick={() => setTelemetryOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 border-[0.5px] border-foreground/30 bg-background text-foreground/80 text-[9px] uppercase tracking-[0.32em] hover:bg-foreground hover:text-background transition-colors"
                aria-expanded={telemetryOpen}
              >
                <FlaskConical className="h-3 w-3" /> Studio notes
                <ChevronDown className={`h-3 w-3 transition-transform ${telemetryOpen ? "rotate-180" : ""}`} />
              </button>
            )}
            {/* Demo Portfolio badge removed */}
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
          <pre className="mb-8 p-4 bg-foreground/[0.04] border-[0.5px] border-foreground/15 font-mono text-[10px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
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
          {/* Header Dossier Summary */}
          <div className="border-b border-border/60 pb-6 text-center md:text-left">
            <span className="text-[9px] uppercase tracking-[0.32em] text-[var(--atelier-gold)] block mb-1">
              Dossier N° {dossierNumber}
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl text-foreground tracking-tight font-medium">
              {profile.subSeason}
            </h2>
            <p className="text-sm text-muted-foreground font-sans mt-1">
              A curated spatial canvas of your seasonal harmonies · {profile.brightness} · {profile.saturation}
            </p>
          </div>

          {/* Primary Core Tones */}
          {primaryBlocks.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-[0.32em] text-foreground font-medium inline-flex items-center gap-1.5">
                Primary Core Tones
                <InfoDot text="The specific color families that naturally complement your skin undertone, bringing out a healthy, radiant glow." />
              </h3>
              <div className={`grid grid-cols-1 sm:grid-cols-2 ${primaryBlocks.length >= 4 ? "md:grid-cols-4" : `md:grid-cols-${primaryBlocks.length}`} gap-3`}>
                {primaryBlocks.map((block, i) => {
                  const ink = readableInk(block.hex);
                  const role = ["Base Silhouette", "Contrast Highlight", "Soft Structure", "Midnight Anchor"][i] ?? "Signature Tone";
                  return (
                    <div
                      key={`${block.hex}-${i}`}
                      className="group relative rounded-2xl overflow-hidden border border-border shadow-sm transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:shadow-xl"
                    >
                      <div className="w-full h-[100px] relative" style={{ backgroundColor: block.hex }}>
                        <span
                          className="absolute top-3 right-3 text-[8px] tracking-[0.2em] font-mono uppercase opacity-80"
                          style={{ color: ink, textShadow: ink === "#ffffff" ? "0 1px 2px rgba(0,0,0,0.25)" : "none" }}
                        >
                          {block.hex.toUpperCase()}
                        </span>
                      </div>
                      <div className="bg-card/95 backdrop-blur-md p-4 flex flex-col justify-between border-t border-border min-h-[88px]">
                        <div className="flex justify-between items-start gap-2">
                          <h4 className="font-serif text-base text-foreground font-medium leading-tight">{block.name}</h4>
                        </div>
                        <div className="text-[9px] uppercase tracking-[0.28em] text-[var(--atelier-gold)] font-medium">
                          {role}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Seasonal Accent Infusions */}
          {accentBlocks.length > 0 && (
            <div className="space-y-4 pt-2">
              <h3 className="text-[10px] uppercase tracking-[0.32em] text-foreground font-medium">
                Seasonal Accent Infusions
              </h3>
              <div className={`grid grid-cols-1 ${accentBlocks.length > 1 ? "md:grid-cols-2" : ""} gap-4`}>
                {accentBlocks.map((block, i) => (
                  <div
                    key={`${block.hex}-${i}`}
                    className="relative rounded-2xl overflow-hidden flex shadow-sm border border-border"
                  >
                    <div className="w-1/3 h-[100px] self-stretch" style={{ backgroundColor: block.hex }} />
                    <div className="w-2/3 bg-card p-5 flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] uppercase tracking-[0.2em] text-[var(--atelier-gold)] font-semibold">
                          {i === 0 ? "Aura Tone" : "Illuminator"}
                        </span>
                        <h4 className="font-serif text-lg text-foreground mt-0.5 leading-tight">{block.name}</h4>
                      </div>
                      <p className="text-xs text-muted-foreground font-sans leading-relaxed">
                        {accentCopy[i] ?? "Layer in to lift the silhouette and personalize the seasonal read."}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disruptive Tones */}
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

          {/* Diagnostic Cells */}
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

      {/* I. Full Palette Matrix */}
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


      {/* II. The Beauty Canvas - Cosmetic Harmonies */}
      <div className="space-y-6 pt-8 border-t border-porcelain/30">
        <div className="flex justify-between items-end mb-2">
          <h3 className="text-xs uppercase tracking-[0.2em] text-ink font-semibold">The Beauty Canvas</h3>
          <span className="text-[10px] text-stone uppercase tracking-widest">Cosmetic Harmonies</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Pillar 1: The Signature Lip */}
          <div className="bg-card p-6 rounded-[20px] border border-border shadow-[0_4px_24px_rgba(43,35,28,0.07),0_1px_4px_rgba(43,35,28,0.04)] space-y-6">
            <div className="text-center pb-4 border-b border-porcelain/50">
              <h4 className="font-serif text-lg text-ink">The Signature Lip</h4>
              <p className="text-[10px] text-stone uppercase tracking-widest mt-1">Pigment &amp; Finish</p>
            </div>
            <div className="space-y-4">
              {[
                { name: 'Rosewood Balm', type: 'Everyday Sheer', swatch: 'oklch(0.60 0.12 15)' },
                { name: 'Crushed Velvet', type: 'Statement Matte', swatch: 'oklch(0.40 0.15 15)' },
                { name: 'Tawny Nude', type: 'Soft Satin', swatch: 'oklch(0.70 0.08 45)' }
              ].map((lip, i) => (
                <div key={i} className="flex items-center gap-4 group">
                  <div
                    className="w-10 h-10 rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] border border-stone/10 shrink-0 transition-transform group-hover:scale-110"
                    style={{ backgroundColor: lip.swatch }}
                  />
                  <div>
                    <h5 className="font-serif text-sm text-ink">{lip.name}</h5>
                    <span className="text-[9px] uppercase tracking-widest text-stone">{lip.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pillar 2: The Natural Flush */}
          <div className="bg-card p-6 rounded-[20px] border border-border shadow-[0_4px_24px_rgba(43,35,28,0.07),0_1px_4px_rgba(43,35,28,0.04)] space-y-6">
            <div className="text-center pb-4 border-b border-porcelain/50">
              <h4 className="font-serif text-lg text-ink">The Natural Flush</h4>
              <p className="text-[10px] text-stone uppercase tracking-widest mt-1">Cheek &amp; Warmth</p>
            </div>
            <div className="space-y-4">
              {[
                { name: 'Muted Mauve', type: 'Cream Blush', swatch: 'oklch(0.65 0.10 350)', fade: 'from-white/40' },
                { name: 'Warm Terracotta', type: 'Powder Sweep', swatch: 'oklch(0.65 0.12 40)', fade: 'from-white/60' },
                { name: 'Soft Apricot', type: 'Liquid Tint', swatch: 'oklch(0.80 0.08 55)', fade: 'from-white/30' }
              ].map((cheek, i) => (
                <div key={i} className="flex items-center gap-4 group">
                  <div
                    className="w-10 h-10 rounded-full shadow-inner border border-stone/10 shrink-0 relative overflow-hidden transition-transform group-hover:scale-110"
                    style={{ backgroundColor: cheek.swatch }}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-tr ${cheek.fade} to-transparent opacity-80`} />
                  </div>
                  <div>
                    <h5 className="font-serif text-sm text-ink">{cheek.name}</h5>
                    <span className="text-[9px] uppercase tracking-widest text-stone">{cheek.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pillar 3: Luminous Accents */}
          <div className="bg-card p-6 rounded-[20px] border border-border shadow-[0_4px_24px_rgba(43,35,28,0.07),0_1px_4px_rgba(43,35,28,0.04)] space-y-6">
            <div className="text-center pb-4 border-b border-porcelain/50">
              <h4 className="font-serif text-lg text-ink">Luminous Accents</h4>
              <p className="text-[10px] text-stone uppercase tracking-widest mt-1">Highlight &amp; Lid</p>
            </div>
            <div className="space-y-4">
              {[
                { name: 'Champagne Pearl', type: 'Highlighter', swatch: 'oklch(0.92 0.04 80)', glow: 'oklch(0.98 0.02 85)' },
                { name: 'Burnished Bronze', type: 'Lid Wash', swatch: 'oklch(0.55 0.08 55)', glow: 'oklch(0.65 0.10 55)' },
                { name: 'Soft Taupe', type: 'Crease Contour', swatch: 'oklch(0.70 0.03 60)', glow: 'oklch(0.75 0.02 60)' }
              ].map((accent, i) => (
                <div key={i} className="flex items-center gap-4 group">
                  <div
                    className="w-10 h-10 rounded-full shadow-inner border border-stone/10 shrink-0 relative overflow-hidden transition-transform group-hover:scale-110"
                    style={{ backgroundColor: accent.swatch }}
                  >
                    <div
                      className="absolute -inset-2 blur-sm opacity-60 rotate-45 transform translate-x-2 translate-y-1"
                      style={{ backgroundColor: accent.glow }}
                    />
                  </div>
                  <div>
                    <h5 className="font-serif text-sm text-ink">{accent.name}</h5>
                    <span className="text-[9px] uppercase tracking-widest text-stone">{accent.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>


      {/* III. Textile & Material Prescriptions */}
      {/* III. Textile Drape & Weight (Fabrication) */}
      <div className="space-y-4 pt-8 border-t border-porcelain/30">
        <div className="flex justify-between items-end mb-4">
          <h3 className="text-xs uppercase tracking-[0.2em] text-ink font-semibold">Textile Drape & Weight</h3>
          <span className="text-[10px] text-stone uppercase tracking-widest">Recommended Core Materials</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { material: profile.fabrication[0] ?? "Heavy Silk", drape: "Fluid & Luminous", color: "bg-card", border: "border-border" },
            { material: profile.fabrication[1] ?? "Crisp Linen", drape: "Structured & Matte", color: "bg-card", border: "border-border" },
            { material: profile.fabrication[2] ?? "Worsted Wool", drape: "Tailored & Dense", color: "bg-card", border: "border-border" },
            { material: profile.fabrication[3] ?? "Cashmere Blend", drape: "Soft & Haloed", color: "bg-card", border: "border-border" },
          ].map((fabric, idx) => (
            <div
              key={idx}
              className={`relative p-5 rounded-2xl border ${fabric.border} ${fabric.color} shadow-atelier-soft h-32 flex flex-col justify-end group transition-all duration-300 hover:shadow-md`}
            >
              <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent rounded-2xl pointer-events-none" />
              <div className="relative z-10">
                <h4 className="font-serif text-lg leading-tight text-ink">
                  {fabric.material}
                </h4>
                <span className="text-[9px] uppercase tracking-[0.15em] block mt-1 text-stone">
                  {fabric.drape}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* IV. The Denim Archive */}
      <div className="space-y-4 pt-8">
        <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--atelier-gold)]">Recommended Textiles · Denim</p>
        <h3 className="text-xs uppercase tracking-[0.2em] text-ink font-semibold">The Denim Archive</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { wash: profile.denimRegistry[0] ?? "Raw Indigo", finish: "Untreated, crisp finish", swatch: "oklch(0.25 0.05 250)", thread: "oklch(0.75 0.15 65)" },
            { wash: profile.denimRegistry[1] ?? "Vintage Mid-Wash", finish: "Softened, natural fade", swatch: "oklch(0.55 0.08 245)", thread: "oklch(0.60 0.05 250)" },
            { wash: profile.denimRegistry[2] ?? "Bone Ecru", finish: "Unbleached natural cotton", swatch: "oklch(0.92 0.02 95)", thread: "oklch(0.85 0.03 90)" },
          ].map((denim, idx) => (
            <div key={idx} className="flex items-center gap-4 p-3 rounded-2xl bg-white border border-stone/10 shadow-atelier-soft">
              <div
                className="w-16 h-16 rounded-full shrink-0 relative overflow-hidden shadow-inner border border-stone/10"
                style={{ backgroundColor: denim.swatch }}
              >
                <div className="absolute left-3 top-0 bottom-0 w-px border-l border-dashed opacity-60" style={{ borderColor: denim.thread }} />
                <div className="absolute left-4 top-0 bottom-0 w-px border-l border-dashed opacity-60" style={{ borderColor: denim.thread }} />
              </div>
              <div>
                <h4 className="font-serif text-base text-ink">{denim.wash}</h4>
                <p className="text-[10px] uppercase tracking-widest text-stone mt-1">{denim.finish}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* V. Exclusions */}
      <SectionBlock
        numeral="V"
        title="Colors to Avoid"
        accent="destructive"
        info="Tones that compete with your natural coloring, which can make your complexion look tired, shadowed, or washed out under standard lighting."
      >
        <div className="border-t border-destructive/30">
          {profile.avoidColors.map((a, i) => {
            const [name, ...rest] = a.split(/[—(]/);
            const detail = rest.join(rest.length > 0 ? "—" : "").replace(/\)\s*$/, "").trim();
            return (
              <div key={i} className={`p-5 flex items-start gap-4 ${i < profile.avoidColors.length - 1 ? "border-b border-destructive/15" : ""}`}>
                <span className="mt-1 h-2 w-2 bg-destructive shrink-0" />
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-foreground">{name.trim()}</p>
                  {detail && <p className="text-xs text-muted-foreground leading-relaxed mt-1">{detail}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </SectionBlock>

      {/* Avoid Harmony Block — Amplified */}
      <div className="space-y-4 pt-8 px-6 sm:px-10">
        <div className="flex justify-between items-end mb-2">
          <h3 className="text-xs uppercase tracking-[0.2em] text-ink font-semibold">Disruptive Tones</h3>
        </div>

        <div className="flex flex-col gap-3">
          {omitTones.map((name, idx) => (
            <DisruptiveToneCard key={`detailed-${name}-${idx}`} name={name} height={72} />
          ))}
        </div>
      </div>


      {/* VI. Analyst's Critique */}
      <section className="px-6 sm:px-10 py-8 border-t-[0.5px] border-border">
        <p className="text-[9px] uppercase tracking-[0.32em] text-[var(--atelier-gold)]">VI · Analyst's Personal Critique</p>
        <div className="mt-4 ml-2 sm:ml-6 border-[0.5px] border-border bg-[var(--atelier-gold-light)] border-l-[3px] border-l-[var(--atelier-gold)] px-6 py-6">
          <blockquote className="font-serif text-base sm:text-lg italic leading-relaxed text-foreground">
            "{profile.stylistNote}"
          </blockquote>
          <div className="mt-5 flex items-center gap-3">
            <span className="h-px w-8 bg-foreground/40" />
            <p className="font-serif italic text-sm tracking-wide text-foreground/70">— Mila, your Atelier Stylist</p>
          </div>
        </div>
      </section>

      {/* Archive Dossier */}
      <div className="px-6 sm:px-10 py-6 border-t-[0.5px] border-border flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="text-[10px] uppercase tracking-[0.2em] gap-2 border-border hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Archive className="h-3.5 w-3.5" />
          Archive Dossier
        </Button>
      </div>
    </section>
  );
}

function DossierCell({ label, value, last, info }: { label: string; value: string; last?: boolean; info?: string }) {
  return (
    <div className={`p-4 ${!last ? "sm:border-r border-border" : ""}`}>
      <p className="text-[9px] uppercase tracking-[0.32em] text-[var(--atelier-gold)] inline-flex items-center gap-1.5">
        {label}
        {info && <InfoDot text={info} />}
      </p>
      <p className="font-serif text-base tracking-tight mt-1">{value}</p>
    </div>
  );
}

function SectionBlock({ numeral, title, children, accent, info }: { numeral: string; title: string; children: React.ReactNode; accent?: "destructive"; info?: string }) {
  const isAlert = accent === "destructive";
  return (
    <section className={`px-6 sm:px-10 py-7 border-t ${isAlert ? "border-destructive/30 bg-destructive/[0.02]" : "border-border"}`}>
      <div className="flex items-baseline gap-3 mb-5">
        <span className={`font-serif text-2xl ${isAlert ? "text-destructive" : "text-foreground/30"}`}>{numeral}</span>
        <h4 className={`text-[10px] uppercase tracking-[0.32em] font-medium inline-flex items-center gap-1.5 ${isAlert ? "text-destructive" : "text-foreground"}`}>
          {title}
          {info && <InfoDot text={info} tone={isAlert ? "destructive" : "default"} />}
        </h4>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

function InfoDot({ text, tone = "default" }: { text: string; tone?: "default" | "destructive" }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className={`inline-flex items-center justify-center h-3.5 w-3.5 rounded-full transition-opacity opacity-60 hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40 ${tone === "destructive" ? "text-destructive/70" : "text-muted-foreground"}`}
        >
          <Info className="h-3 w-3" strokeWidth={1.25} />
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

function SwatchStrip({ label, swatches }: { label: string; swatches: Swatch[] }) {
  const cols = swatches.length >= 4 ? "grid-cols-4" : swatches.length === 3 ? "grid-cols-3" : "grid-cols-2";
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.32em] text-[var(--atelier-gold)] mb-3">{label}</p>
      <div className={`grid ${cols} gap-0 border-[0.5px] border-border`}>
        {swatches.map((s, i) => {
          const ink = readableInk(s.hex);
          return (
            <div
              key={i}
              className={`relative h-[100px] flex flex-col justify-between p-2 ${i < swatches.length - 1 ? "border-r border-border" : ""}`}
              style={{ backgroundColor: s.hex }}
            >
              <p
                className="text-[9px] uppercase tracking-[0.22em] leading-tight font-medium"
                style={{ color: ink, textShadow: ink === "#ffffff" ? "0 1px 2px rgba(0,0,0,0.25)" : "none" }}
              >
                {s.name}
              </p>
              <p
                className="text-[8px] tracking-[0.2em] font-mono self-end opacity-80"
                style={{ color: ink }}
              >
                {s.hex.toUpperCase()}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PaletteCard({ title, swatches, fullPalette }: { title: string; swatches: Swatch[]; fullPalette?: string[] }) {
  // Prefer the curated 20-hex PCCS matrix when present; fall back to repeating swatches.
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
            <span className="ml-2 not-italic font-light text-neutral-700">{rest.join(" ").toUpperCase()}</span>
          )}
        </h5>
        <p className="mt-1 text-[11px] tracking-[0.5em] text-neutral-700 uppercase">P a l e t t e</p>
      </div>
      <div className="mt-7 mx-auto max-w-[280px] grid grid-cols-5 gap-3 sm:gap-4">
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

function BeautyCard({
  label,
  body,
  accent,
}: {
  label: string;
  body: string | string[] | null | undefined;
  accent: string;
}) {
  const items = Array.isArray(body)
    ? body.filter((b): b is string => typeof b === "string" && b.trim().length > 0)
    : typeof body === "string" && body.trim().length > 0
      ? [body]
      : [];
  const isEmpty = items.length === 0;
  return (
    <div className="rounded-2xl border-[0.5px] border-border bg-foreground/[0.02] p-5">
      <div className="flex items-center gap-3">
        <span
          className="h-8 w-8 rounded-full ring-1 ring-black/10 shrink-0"
          style={{ backgroundColor: accent }}
        />
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-[0.32em] text-[var(--atelier-gold)]">{label}</p>
          {isEmpty ? (
            <p className="mt-1 text-xs text-muted-foreground italic leading-relaxed">
              Curating your recommendations…
            </p>
          ) : items.length === 1 ? (
            <p className="mt-1 text-xs text-foreground leading-relaxed">{items[0]}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {items.map((it, i) => (
                <li
                  key={i}
                  className="text-xs text-foreground leading-relaxed flex items-start gap-2"
                >
                  <span className="h-1 w-1 mt-2 bg-foreground/50 shrink-0" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function readableInk(hex: string): "#ffffff" | "#0a0a0a" {
  const m = hex.replace("#", "");
  if (m.length !== 6) return "#0a0a0a";
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#0a0a0a" : "#ffffff";
}

function ContrastGauge({ value }: { value: string }) {
  const v = (value || "").toLowerCase();
  let raw = 50;
  if (/very high|striking|block|maximal|dramatic/.test(v)) raw = 92;
  else if (/high/.test(v)) raw = 78;
  else if (/medium-high|mid-high/.test(v)) raw = 65;
  else if (/medium|moderate|balanced/.test(v)) raw = 50;
  else if (/medium-low|mid-low/.test(v)) raw = 35;
  else if (/very low|monochromatic|minimal/.test(v)) raw = 10;
  else if (/low|muted|soft|tonal/.test(v)) raw = 22;
  // Clamp to keep the marker visually inside the track at extremes
  const pct = Math.max(4, Math.min(96, raw));
  return (
    <div className="mt-6 border-t-[0.5px] border-border pt-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] uppercase tracking-[0.32em] text-[var(--atelier-gold)]">Contrast Spectrum</p>
        <p className="text-[9px] uppercase tracking-[0.32em] text-foreground font-medium">{value}</p>
      </div>
      <div className="relative h-[4px] rounded-full bg-foreground/15">
        <div className="absolute inset-y-0 left-0 rounded-full bg-foreground" style={{ width: `${pct}%` }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
          style={{ left: `${pct}%` }}
        >
          <div className="h-[13px] w-[13px] rounded-full bg-background border-2 border-foreground shadow-sm" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[8px] uppercase tracking-[0.28em] text-[var(--atelier-gold)]">
        <span>Low · Muted / Monochromatic</span>
        <span>High · Striking / Block</span>
      </div>
    </div>
  );
}

function MaterialMatrix({ textiles, hardware }: { textiles: string[]; hardware: string[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border-[0.5px] border-border">
      <div className="p-5 sm:border-r border-border bg-foreground/[0.015]">
        <p className="text-[9px] uppercase tracking-[0.32em] text-[var(--atelier-gold)] mb-3">Textiles & Fabrications</p>
        <div className="flex flex-wrap gap-1.5">
          {textiles.filter(Boolean).map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] border-[0.5px] border-foreground/30 bg-card text-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="p-5 bg-foreground/[0.04]">
        <p className="text-[9px] uppercase tracking-[0.32em] text-[var(--atelier-gold)] mb-3">Hardware & Jewelry</p>
        <ul className="divide-y divide-foreground/10 border-y-[0.5px] border-foreground/15">
          {hardware.filter(Boolean).map((h, i) => (
            <li key={i} className="flex items-center justify-between py-2 text-[11px] uppercase tracking-[0.16em] text-foreground">
              <span>{h}</span>
              <span className="font-mono text-[9px] text-muted-foreground">0{i + 1}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function VanityCell({ label, body, last }: { label: string; body: string; last?: boolean }) {
  return (
    <div className={`p-5 ${!last ? "sm:border-r border-border" : ""}`}>
      <p className="text-[9px] uppercase tracking-[0.32em] text-[var(--atelier-gold)]">{label}</p>
      <p className="mt-2 text-xs text-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function PrescriptionRow({ label, items, last }: { label: string; items: string[]; last?: boolean }) {
  return (
    <div className={`grid grid-cols-[180px_1fr] gap-6 py-3 ${!last ? "border-b-[0.5px] border-border" : ""}`}>
      <p className="text-[9px] uppercase tracking-[0.28em] text-[var(--atelier-gold)] pt-0.5">{label}</p>
      <ul className="space-y-1.5">
        {items.filter(Boolean).map((it, i) => (
          <li key={i} className="text-xs text-foreground leading-relaxed flex items-start gap-2">
            <span className="h-1 w-1 mt-2 bg-foreground/50 shrink-0" /> {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Anthropometric calculator removed — silhouette is resolved through the
// elegant 3-step BodyTypeQuiz above. Body shape is no longer derived from
// numerical measurements.
