import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { RefreshCw, Sparkles, Bookmark } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { generateDailyPalette, type DailyPalette } from "@/lib/color-analysis/paletteGenerator";
import { memberSwatches } from "@/lib/color-analysis/member-swatches";
import {
  RECENT_TRIOS,
  WEAR_LINES,
  buildDailyPalette,
  localDateKey,
  paletteForKey,
  paletteSeed,
  pushRecent,
  trioKey,
} from "@/lib/color-analysis/daily-palette";
import {
  initialPaletteState,
  readPaletteState,
  recordShown,
  writePaletteState,
  type PaletteState,
} from "@/lib/palette-recent";
import { profileQueryOptions } from "@/lib/queries/profile";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const hexesOf = (p: Pick<DailyPalette, "baseHex" | "statementHex" | "accentHex">) => [
  p.baseHex,
  p.statementHex,
  p.accentHex,
];

const announcement = (p: DailyPalette) =>
  `New palette: ${p.baseColor}, ${p.statementColor} and ${p.accentColor}.`;

/**
 * `startFresh` (a check-in just changed her) opens on the next pick, never the
 * trio she had: it keeps what this device remembers and excludes the one on screen.
 */
export function DailyPaletteGenerator({
  userColorSeason,
  startFresh = false,
}: {
  userColorSeason: string | null;
  startFresh?: boolean;
}) {
  const [isRotating, setIsRotating] = useState(false);
  const [mixCount, setMixCount] = useState(1);
  const [announce, setAnnounce] = useState("");
  const reduce = useReducedMotion() ?? false;

  const { user } = useAuth();
  const profileQuery = useQuery({
    ...profileQueryOptions(user?.id),
    enabled: !!user?.id,
  });
  const loadingProfile = !!user?.id && profileQuery.isPending;
  const profileFailed = !!user?.id && profileQuery.isError && !profileQuery.data;
  const hasRead = profileQuery.isSuccess;
  const colorProfile = profileQuery.data?.color_profile;
  const swatches = useMemo(() => memberSwatches(colorProfile), [colorProfile]);
  const fromOwnColors = swatches.length >= 3;

  // The local day, re-read when she comes back to the tab, so a card left open
  // past midnight starts the new day's palette.
  const [todayKey, setTodayKey] = useState(() => localDateKey(new Date()));
  useEffect(() => {
    const refresh = () => setTodayKey(localDateKey(new Date()));
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // What this device remembers, read again whenever the member or the day changes
  // (the member is not known on the first render). Shuffles override it for the same pair.
  const userId = user?.id;
  const stored = useMemo<PaletteState>(
    () =>
      userId
        ? initialPaletteState(readPaletteState(userId, todayKey), startFresh)
        : { dateKey: todayKey, attempt: 0, recent: [] },
    [userId, todayKey, startFresh],
  );
  const [override, setOverride] = useState<{
    userId: string;
    dateKey: string;
    state: PaletteState;
  } | null>(null);
  const daily =
    override && override.userId === userId && override.dateKey === todayKey
      ? override.state
      : stored;
  const setDaily = useCallback(
    (state: PaletteState) => {
      if (userId) setOverride({ userId, dateKey: state.dateKey, state });
    },
    [userId],
  );
  const [curated, setCurated] = useState(() => generateDailyPalette(userColorSeason));

  // The trio on screen is the one recorded as shown, so a reload shows it again.
  const ownPalette = useMemo(() => {
    if (!user?.id || !fromOwnColors) return null;
    const shownKey = daily.shown;
    return (
      (shownKey ? paletteForKey({ swatches, key: shownKey }) : null) ??
      buildDailyPalette({
        swatches,
        seed: paletteSeed(user.id, daily.dateKey, daily.attempt),
        recent: daily.recent,
      })
    );
  }, [user?.id, fromOwnColors, swatches, daily]);
  const look = ownPalette ?? curated;

  // Record today's pick the moment it is shown, so tomorrow cannot repeat it.
  const ownKey = ownPalette ? trioKey(hexesOf(ownPalette)) : null;
  useEffect(() => {
    if (!userId || !ownKey || daily.shown === ownKey) return;
    const recorded = recordShown(daily, ownKey);
    setDaily(recorded);
    writePaletteState(userId, recorded);
  }, [userId, ownKey, daily, setDaily]);
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

  const today = new Date(`${todayKey}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const shuffleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (shuffleTimeoutRef.current) clearTimeout(shuffleTimeoutRef.current);
    };
  }, []);

  const handleShuffle = useCallback(() => {
    if (shuffleTimeoutRef.current) clearTimeout(shuffleTimeoutRef.current);
    setIsRotating(true);
    setMixCount((c) => c + 1);

    // Her own colours: skip the last five trios, so a shuffle never repeats one.
    let next: PaletteState | null = null;
    let nextOwn: DailyPalette | null = null;
    if (user?.id && ownPalette) {
      const prior = pushRecent(daily.recent, trioKey(hexesOf(ownPalette)), RECENT_TRIOS);
      const attempt = daily.attempt + 1;
      nextOwn = buildDailyPalette({
        swatches,
        seed: paletteSeed(user.id, daily.dateKey, attempt),
        recent: prior,
      });
      if (nextOwn) {
        next = recordShown(
          { dateKey: daily.dateKey, attempt, recent: prior },
          trioKey(hexesOf(nextOwn)),
        );
      }
    }

    shuffleTimeoutRef.current = setTimeout(() => {
      if (next && nextOwn && user?.id) {
        setDaily(next);
        writePaletteState(user.id, next);
        setAnnounce(announcement(nextOwn));
      } else {
        const following = generateDailyPalette(userColorSeason, look);
        setCurated(following);
        setAnnounce(announcement(following));
      }
      setIsRotating(false);
    }, 700);
  }, [user?.id, ownPalette, daily, setDaily, swatches, look, userColorSeason]);

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

  const rows = useMemo(
    () => [
      { label: "Base", wear: WEAR_LINES.base, name: look.baseColor, hex: look.baseHex },
      {
        label: "Statement",
        wear: WEAR_LINES.statement,
        name: look.statementColor,
        hex: look.statementHex,
      },
      { label: "Accent", wear: WEAR_LINES.accent, name: look.accentColor, hex: look.accentHex },
    ],
    [look],
  );

  return (
    <div className="bg-card rounded-card shadow-paper border border-border p-5 space-y-5">
      <div className="flex items-center justify-between">
        <span className="atelier-kicker">Today · {today}</span>
        <span className="inline-flex items-center rounded-pill bg-accent-soft px-2.5 py-0.5 text-micro uppercase tracking-label text-ink">
          {look.styleVibe}
        </span>
        <span className="atelier-kicker">Mix {String(mixCount).padStart(2, "0")}</span>
      </div>

      {profileFailed ? (
        <div role="alert" className="space-y-3 text-center">
          <p className="text-sm text-foreground">We couldn&apos;t load your colors. Try again.</p>
          <Button
            variant="outline"
            onClick={() => void profileQuery.refetch()}
            className="min-h-11"
          >
            Try again
          </Button>
        </div>
      ) : loadingProfile ? (
        <div role="status" aria-label="Loading your colors" className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              data-palette-skeleton=""
              className="flex flex-col items-center rounded-control border border-border/40 p-3"
            >
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="mt-2.5 h-3 w-12 rounded-pill" />
              <Skeleton className="mt-1.5 h-3.5 w-16 rounded-pill" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {rows.map((s, i) => (
            <div
              key={s.label}
              className="flex flex-col items-center justify-center rounded-control border border-border/40 p-3 text-center backdrop-blur-md"
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
                className="size-10 rounded-full border-2 border-card shadow-sm"
                style={{ backgroundColor: s.hex }}
              />
              <div className="mt-2.5 space-y-0.5">
                <p className="text-micro uppercase tracking-widest text-muted-foreground">
                  {s.label}
                </p>
                <p className="text-sm font-medium leading-tight text-foreground">{s.name}</p>
                <p className="text-micro leading-snug text-muted-foreground">{s.wear}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {profileFailed ? null : (
        <div className="rounded-control border border-accent/60 bg-accent-soft p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="size-4 text-ink mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-[13px] text-muted-foreground leading-snug">
              <strong className="text-ink">Mila&apos;s take:</strong>{" "}
              {look.isSisterSeasonIncluded
                ? "I borrowed the accent from your Sister Season for a little range without leaving your palette."
                : look.insight}
            </p>
          </div>
        </div>
      )}

      {hasRead && !fromOwnColors ? (
        <p className="text-[13px] leading-snug text-muted-foreground">
          Palettes from your own colors start after your color read.{" "}
          <Link
            to="/style-profile"
            className="atelier-focus-ring inline-flex min-h-11 items-center rounded-control font-medium text-ink underline underline-offset-2"
          >
            Read my colors
          </Link>
        </p>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {profileFailed ? null : (
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

          <Button onClick={handleShuffle} loading={isRotating} className="flex-1">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            <span>Shuffle palette</span>
          </Button>
        </div>
      )}

      <Link
        to="/palettes"
        className="atelier-focus-ring flex items-center justify-center gap-1.5 rounded-control text-micro uppercase tracking-label-wide text-muted-foreground transition-colors hover:text-ink"
      >
        <Bookmark className="size-3" strokeWidth={1.75} aria-hidden="true" />
        {savedCount > 0
          ? `View ${savedCount} saved palette${savedCount === 1 ? "" : "s"}`
          : "View saved palettes"}
      </Link>
    </div>
  );
}
