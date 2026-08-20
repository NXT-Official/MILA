import { useState, useCallback, useMemo } from "react";
import { RefreshCw, Sparkles, Bookmark } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { generateDailyPalette } from "@/lib/color-analysis/paletteGenerator";
import { migrateLegacySeason } from "@/lib/color-analysis/schemaMigration";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import {
  deleteSavedPalette,
  savePalette,
  savedPalettesQueryOptions,
} from "@/lib/queries/saved-palettes";
import { errorMessage } from "@/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import type { SeasonId } from "@/lib/color-analysis/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function DailyPaletteGenerator({ userColorSeason }: { userColorSeason: string | null }) {
  const [mixCount, setMixCount] = useState(1);
  const reduce = useReducedMotion() ?? false;

  const normalizedSeason = userColorSeason
    ? migrateLegacySeason(userColorSeason)
    : ("cool_summer" as SeasonId);
  const [look, setLook] = useState(() => generateDailyPalette(normalizedSeason));

  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: savedPalettes } = useQuery({
    ...savedPalettesQueryOptions(user?.id),
    enabled: !!user?.id,
  });

  // The pin lives in the saved collection, so this stays true across devices.
  const savedRow = savedPalettes?.find(
    (row) =>
      row.palette.baseHex === look.baseHex &&
      row.palette.statementHex === look.statementHex &&
      row.palette.accentHex === look.accentHex,
  );
  const saved = !!savedRow;
  const savedCount = savedPalettes?.length ?? 0;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const handleShuffle = useCallback(() => {
    setMixCount((c) => c + 1);
    setLook(generateDailyPalette(normalizedSeason));
  }, [normalizedSeason]);

  const [pending, setPending] = useState(false);
  const toggleSaved = useCallback(async () => {
    if (!user) return;
    setPending(true);
    try {
      if (savedRow) {
        await deleteSavedPalette(user.id, savedRow.id);
        await queryClient.invalidateQueries({ queryKey: queryKeys.savedPalettes(user.id) });
        toast.success("Palette removed from your saved list.");
      } else {
        await savePalette(user.id, look);
        await queryClient.invalidateQueries({ queryKey: queryKeys.savedPalettes(user.id) });
        toast.success(`${look.styleVibe} saved.`, {
          action: { label: "View all", onClick: () => navigate({ to: "/palettes" }) },
        });
      }
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't update your saved palettes."));
    } finally {
      setPending(false);
    }
  }, [user, savedRow, look, queryClient, navigate]);

  const swatches = useMemo(
    () => [
      { label: "Base Layer", name: look.baseColor, hex: look.baseHex },
      { label: "Statement", name: look.statementColor, hex: look.statementHex },
      { label: "Accent Pop", name: look.accentColor, hex: look.accentHex },
    ],
    [look],
  );

  return (
    <Card asChild className="p-5 space-y-5">
      <section aria-labelledby="daily-palette-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h2 id="daily-palette-heading" className="atelier-headline">
              Today’s palette
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{today}</span>
              <span className="inline-flex items-center rounded-pill bg-accent-soft px-2.5 py-0.5 text-micro uppercase tracking-label text-ink">
                {look.styleVibe}
              </span>
            </div>
          </div>
          <span className="text-xs uppercase tracking-label tabular-nums text-muted-foreground">
            Mix {String(mixCount).padStart(2, "0")}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {swatches.map((s, i) => (
            <div
              key={s.label}
              // justify-start, not center: the cells stretch to the tallest colour
              // name, and centring pushed each circle to a different height.
              className="flex flex-col items-center justify-start rounded-panel border border-border/60 p-3 text-center"
              style={{ backgroundColor: hexToRgba(s.hex, 0.08) }}
            >
              <motion.div
                key={`${look.baseHex}-${look.statementHex}-${look.accentHex}-${i}`}
                initial={{ scale: reduce ? 1 : 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  duration: reduce ? 0.2 : 0.35,
                  ease: [0.22, 1, 0.36, 1],
                  delay: reduce ? 0 : i * 0.06,
                }}
                className="size-10 rounded-full border border-card"
                style={{ backgroundColor: s.hex }}
              />
              <div className="mt-2.5 space-y-0.5">
                <p className="atelier-label">{s.label}</p>
                <p className="text-sm font-medium leading-tight text-foreground">{s.name}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-panel border border-border bg-accent-soft p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="size-4 text-ink mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-sm text-muted-foreground leading-snug">
              <strong className="text-ink">Mila’s take —</strong>{" "}
              {look.isSisterSeasonIncluded
                ? "I borrowed the accent from your Sister Season for a little range without leaving your palette."
                : look.insight}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <IconButton
            onClick={toggleSaved}
            disabled={pending || !user}
            variant={saved ? "primary" : "outline"}
            label={saved ? "Unsave palette" : "Save palette"}
          >
            <Bookmark
              className="size-4"
              fill={saved ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </IconButton>

          <Button onClick={handleShuffle} className="flex-1">
            <RefreshCw aria-hidden="true" />
            <span>New mix</span>
          </Button>
        </div>

        <Link
          to="/palettes"
          className="atelier-focus-ring flex items-center justify-center gap-1.5 rounded-control text-micro uppercase tracking-label-wide text-muted-foreground transition-colors hover:text-ink"
        >
          <Bookmark className="size-3" strokeWidth={1.75} aria-hidden="true" />
          {savedCount > 0
            ? `View ${savedCount} saved palette${savedCount === 1 ? "" : "s"}`
            : "View saved palettes"}
        </Link>
      </section>
    </Card>
  );
}
