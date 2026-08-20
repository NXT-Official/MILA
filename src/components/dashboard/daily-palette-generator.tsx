import { useState, useCallback, useMemo } from "react";
import { RefreshCw, Bookmark } from "lucide-react";
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

export function DailyPaletteGenerator({ userColorSeason }: { userColorSeason: string | null }) {
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
    <Card asChild className="space-y-6 p-5 shadow-none">
      <section aria-labelledby="daily-palette-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="daily-palette-heading" className="atelier-headline">
            Today’s palette
          </h2>
          <p className="text-xs text-muted-foreground">
            {look.styleVibe} · {today}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {swatches.map((s, i) => (
            // The swatch is the only saturated thing here: no tinted cell, no
            // border competing with the colour it is supposed to show.
            <div key={s.label} className="flex flex-col items-center text-center">
              <motion.div
                key={`${look.baseHex}-${look.statementHex}-${look.accentHex}-${i}`}
                initial={{ scale: reduce ? 1 : 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  duration: reduce ? 0.2 : 0.3,
                  ease: [0.22, 1, 0.36, 1],
                  delay: reduce ? 0 : i * 0.04,
                }}
                className="size-12 rounded-full border border-border/60"
                style={{ backgroundColor: s.hex }}
              />
              <div className="mt-3 space-y-0.5">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-sm font-medium leading-tight text-foreground">{s.name}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="border-t border-border/70 pt-4 text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-ink">Mila’s take —</span>{" "}
          {look.isSisterSeasonIncluded
            ? "I borrowed the accent from your Sister Season for a little range without leaving your palette."
            : look.insight}
        </p>

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

          <Button onClick={handleShuffle} variant="outline" className="flex-1">
            <RefreshCw aria-hidden="true" />
            <span>New mix</span>
          </Button>
        </div>

        <Link
          to="/palettes"
          className="atelier-focus-ring block rounded-control text-center text-sm text-muted-foreground transition-colors hover:text-ink"
        >
          {savedCount > 0
            ? `View ${savedCount} saved palette${savedCount === 1 ? "" : "s"}`
            : "View saved palettes"}
        </Link>
      </section>
    </Card>
  );
}
