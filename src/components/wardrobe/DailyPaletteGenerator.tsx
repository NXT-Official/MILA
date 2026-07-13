import { useState, useCallback, useMemo } from "react";
import { RefreshCw, Sparkles, Bookmark } from "lucide-react";
import { motion } from "framer-motion";
import { generateDailyPalette } from "@/lib/color-analysis/paletteGenerator";
import { migrateLegacySeason } from "@/lib/color-analysis/schemaMigration";
import type { SeasonId } from "@/lib/color-analysis/types";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function DailyPaletteGenerator({ userColorSeason }: { userColorSeason: string | null }) {
  const [isRotating, setIsRotating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mixCount, setMixCount] = useState(1);

  const normalizedSeason = userColorSeason
    ? migrateLegacySeason(userColorSeason)
    : ("cool_summer" as SeasonId);
  const [look, setLook] = useState(generateDailyPalette(normalizedSeason));

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const handleShuffle = useCallback(() => {
    setIsRotating(true);
    setMixCount((c) => c + 1);
    setSaved(false);
    setTimeout(() => {
      const next = generateDailyPalette(normalizedSeason);
      setLook(next);
      setIsRotating(false);
    }, 700);
  }, [normalizedSeason]);

  const swatches = useMemo(
    () => [
      { label: "Base Layer", name: look.baseColor, hex: look.baseHex },
      { label: "Statement", name: look.statementColor, hex: look.statementHex },
      { label: "Accent Pop", name: look.accentColor, hex: look.accentHex },
    ],
    [look],
  );

  return (
    <div className="bg-card rounded-card shadow-paper border border-border p-5 space-y-5">
      <div className="flex items-center justify-between">
        <span className="atelier-kicker">{today}</span>
        <span className="inline-flex items-center rounded-pill bg-accent-soft px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-accent">
          {look.styleVibe}
        </span>
        <span className="atelier-kicker">Mix {String(mixCount).padStart(2, "0")}</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {swatches.map((s, i) => (
          <div
            key={s.label}
            className="flex flex-col items-center justify-center rounded-xl border border-border/40 p-3 text-center backdrop-blur-md transition-all hover:shadow-md"
            style={{ backgroundColor: hexToRgba(s.hex, 0.08) }}
          >
            <motion.div
              key={`${look.baseHex}-${look.statementHex}-${look.accentHex}-${i}`}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 18, delay: i * 0.06 }}
              className="size-10 rounded-full border-2 border-white shadow-sm"
              style={{ backgroundColor: s.hex }}
            />
            <div className="mt-2.5 space-y-0.5">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {s.label}
              </p>
              <p className="text-sm font-medium leading-tight text-foreground">{s.name}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-accent-soft border-l-[3px] border-l-accent p-3">
        <div className="flex items-start gap-2">
          <Sparkles className="size-4 text-accent mt-0.5 shrink-0" />
          <p className="text-[13px] text-muted-foreground leading-snug">
            <strong className="text-accent">Mila&apos;s take —</strong>{" "}
            {look.isSisterSeasonIncluded
              ? "I borrowed the accent from your Sister Season for a little range without leaving your palette."
              : look.insight}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <IconButton
          onClick={() => setSaved((s) => !s)}
          variant={saved ? "primary" : "outline"}
          label={saved ? "Unsave palette" : "Save palette"}
        >
          <Bookmark className="size-4" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
        </IconButton>

        <Button onClick={handleShuffle} loading={isRotating} className="flex-1">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          <span>Generate Next Look</span>
        </Button>
      </div>
    </div>
  );
}
