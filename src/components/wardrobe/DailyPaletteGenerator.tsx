import { useState, useCallback, useMemo } from "react";
import { RefreshCw, Sparkles, Bookmark } from "lucide-react";
import { motion } from "framer-motion";
import { generateDailyPalette } from "@/lib/color-analysis/paletteGenerator";
import { migrateLegacySeason } from "@/lib/color-analysis/schemaMigration";
import type { SeasonId } from "@/lib/color-analysis/types";

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

  const normalizedSeason = userColorSeason ? migrateLegacySeason(userColorSeason) : ("cool_summer" as SeasonId);
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
    <div className="bg-card rounded-[20px] shadow-[0_4px_24px_rgba(43,35,28,0.07),0_1px_4px_rgba(43,35,28,0.04)] border border-border p-5 space-y-5">
      {/* Eyebrow Row */}
      <div className="flex items-center justify-between">
        <span className="atelier-kicker">
          {today}
        </span>
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em]"
          style={{ backgroundColor: "var(--atelier-gold-light)", color: "var(--atelier-gold)" }}
        >
          {look.styleVibe}
        </span>
        <span className="atelier-kicker">
          Mix {String(mixCount).padStart(2, "0")}
        </span>
      </div>

      {/* Color Cards */}
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
              className="h-10 w-10 rounded-full border-2 border-white shadow-sm"
              style={{ backgroundColor: s.hex }}
            />
            <div className="mt-2.5 space-y-0.5">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {s.label}
              </p>
              <p className="text-sm font-medium leading-tight text-foreground">
                {s.name}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Insight Copy */}
      <div className="rounded-xl bg-[var(--atelier-gold-light)] border-l-[3px] border-l-[var(--atelier-gold)] p-3">
        <div className="flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-[var(--atelier-gold)] mt-0.5 shrink-0" />
          <p className="text-[13px] text-muted-foreground leading-snug">
            <strong className="text-[var(--atelier-gold)]">Mila&apos;s take —</strong>{" "}
            {look.isSisterSeasonIncluded
              ? "I borrowed the accent from your Sister Season for a little range without leaving your palette."
              : look.insight}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => setSaved((s) => !s)}
          className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 ${
            saved
              ? "bg-[#2B2B2F] text-white"
              : "bg-[#F2EDE6] text-[#2B2B2F]"
          }`}
          aria-label={saved ? "Unsave palette" : "Save palette"}
        >
          <Bookmark
            className="w-4 h-4"
            fill={saved ? "currentColor" : "none"}
          />
        </button>

        <button
          onClick={handleShuffle}
          disabled={isRotating}
          className="flex-1 flex items-center justify-center space-x-2 text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-black py-2.5 px-4 rounded-xl transition-all duration-200 shadow-sm active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isRotating ? "animate-spin" : ""}`}
          />
          <span>Generate Next Look</span>
        </button>
      </div>
    </div>
  );
}
