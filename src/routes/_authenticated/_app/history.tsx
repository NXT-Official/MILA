import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Images, ImageOff, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GeneratedLookDetail } from "@/components/dashboard/generated-look-detail";
import { useConcierge } from "@/hooks/use-concierge";
import { cn } from "@/lib/utils";
import type { DailyLook } from "@/lib/generate-outfit.functions";

export const Route = createFileRoute("/_authenticated/_app/history")({
  component: History,
});

interface OutfitRow {
  id: string;
  image_url: string;
  match_score: number | null;
  created_at: string;
  analysis_result: unknown;
}

interface LensAnalysis {
  color_match?: string;
  silhouette?: string;
  overall_score?: number;
  verdict?: string;
}

interface DailyLookAnalysis {
  type: "daily_look";
  weather?: string;
  vibe?: string;
  vibe_alignment_score?: number;
  outfit: DailyLook["outfit"];
  hair: DailyLook["hair"];
  makeup: DailyLook["makeup"];
}

type NormalizedAnalysis =
  | { kind: "daily_look"; data: DailyLookAnalysis }
  | { kind: "lens"; data: LensAnalysis }
  | { kind: "unavailable" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Safely reads whatever is actually in `outfits.analysis_result` — an
 * object already (the normal case), a JSON string (some legacy path), or
 * malformed/empty data. Never throws; unrecognized shapes degrade to an
 * "unavailable" state instead of crashing the page.
 */
function normalizeAnalysisResult(raw: unknown): NormalizedAnalysis {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { kind: "unavailable" };
    }
  }
  if (!isPlainObject(value)) return { kind: "unavailable" };

  if (
    value.type === "daily_look" &&
    isPlainObject(value.outfit) &&
    typeof value.outfit.headline === "string" &&
    isPlainObject(value.hair) &&
    isPlainObject(value.makeup)
  ) {
    return { kind: "daily_look", data: value as unknown as DailyLookAnalysis };
  }

  if (
    typeof value.color_match === "string" ||
    typeof value.silhouette === "string" ||
    typeof value.verdict === "string" ||
    typeof value.overall_score === "number"
  ) {
    return { kind: "lens", data: value as LensAnalysis };
  }

  return { kind: "unavailable" };
}

function historyItemTitle(analysis: NormalizedAnalysis): string {
  if (analysis.kind === "daily_look") return analysis.data.outfit.headline;
  if (analysis.kind === "lens") return "Outfit Analysis";
  return "Saved Look";
}

/** An image with a graceful, styled fallback — never a broken-image icon or bare alt text. */
function HistoryImage({
  src,
  alt,
  frameClassName,
}: {
  src: string | null | undefined;
  alt: string;
  frameClassName: string;
}) {
  const [broken, setBroken] = useState(false);
  const showFallback = !src || broken;
  return (
    <div className={frameClassName}>
      {showFallback ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
          <ImageOff className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Visual unavailable
          </p>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-contain bg-foreground/4"
          onError={() => setBroken(true)}
        />
      )}
    </div>
  );
}

function HistoryCard({ item, onOpen }: { item: OutfitRow; onOpen: () => void }) {
  const analysis = normalizeAnalysisResult(item.analysis_result);
  const title = historyItemTitle(analysis);
  const badge = analysis.kind === "daily_look" ? analysis.data.vibe : null;

  return (
    <button
      onClick={onOpen}
      className="atelier-hairline-card aspect-square relative overflow-hidden text-left cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <HistoryImage
        src={item.image_url}
        alt={`Generated visualization of ${title}`}
        frameClassName="h-full w-full bg-card"
      />
      <div className="absolute inset-0 bg-atelier-ink/0 group-hover:bg-atelier-ink/20 transition-colors pointer-events-none" />
      <div className="absolute bottom-0 inset-x-0 p-4 bg-linear-to-t from-atelier-ink/85 via-atelier-ink/40 to-transparent text-atelier-ivory pointer-events-none">
        {badge ? (
          <p className="mb-1 text-[9px] uppercase tracking-[0.24em] opacity-80">{badge}</p>
        ) : null}
        <p className="font-serif text-base leading-snug line-clamp-2">{title}</p>
        <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-widest opacity-70">
          <span>{new Date(item.created_at).toLocaleDateString()}</span>
          {item.match_score != null ? (
            <>
              <span className="h-1 w-1 rounded-full bg-current" />
              <span>{item.match_score}</span>
            </>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function HistoryDetailBody({ item, analysis }: { item: OutfitRow; analysis: NormalizedAnalysis }) {
  if (analysis.kind === "daily_look") {
    const { outfit, hair, makeup, weather, vibe, vibe_alignment_score } = analysis.data;
    return (
      <div className="space-y-6">
        {(vibe || vibe_alignment_score != null || weather) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[10px] uppercase tracking-[0.22em]">
              {vibe ? <span className="text-muted-foreground">{vibe}</span> : null}
              {vibe_alignment_score != null ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-foreground/40" />
                  <span className="font-medium">Vibe fit {vibe_alignment_score}/10</span>
                </>
              ) : null}
              {weather ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-foreground/40" />
                  <span className="text-muted-foreground">{weather}</span>
                </>
              ) : null}
            </span>
          </div>
        )}
        <GeneratedLookDetail
          outfit={outfit}
          hair={hair}
          makeup={makeup}
          media={
            <HistoryImage
              src={item.image_url}
              alt={`Generated visualization of ${outfit.headline}`}
              frameClassName="relative mx-auto aspect-square w-full max-w-128 overflow-hidden rounded-card border border-border bg-card shadow-paper"
            />
          }
        />
      </div>
    );
  }

  if (analysis.kind === "lens") {
    const { verdict, color_match, silhouette } = analysis.data;
    return (
      <div className="space-y-6">
        <HistoryImage
          src={item.image_url}
          alt="Analyzed outfit photo"
          frameClassName="relative mx-auto aspect-square w-full max-w-128 overflow-hidden rounded-card border border-border bg-card shadow-paper"
        />
        {verdict ? (
          <div className="rounded-card border border-border bg-card p-6 shadow-paper">
            <p className="mb-3 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Stylist's Verdict
            </p>
            <p className="font-serif text-xl leading-relaxed">{verdict}</p>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {color_match ? (
            <div className="rounded-card border border-border bg-card p-6 shadow-paper">
              <p className="mb-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Color Match
              </p>
              <p className="text-sm leading-relaxed">{color_match}</p>
            </div>
          ) : null}
          {silhouette ? (
            <div className="rounded-card border border-border bg-card p-6 shadow-paper">
              <p className="mb-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Silhouette
              </p>
              <p className="text-sm leading-relaxed">{silhouette}</p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border bg-card/60 p-10 text-center">
      <p className="text-sm text-muted-foreground">This saved look is no longer available.</p>
    </div>
  );
}

function History() {
  const { user } = useAuth();
  const { openConcierge } = useConcierge();
  const [items, setItems] = useState<OutfitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<OutfitRow | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("outfits")
      .select("id,image_url,match_score,created_at,analysis_result")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoadError(true);
        } else {
          setItems(data ?? []);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const selectedAnalysis = selected ? normalizeAnalysisResult(selected.analysis_result) : null;

  return (
    <div className="atelier-page max-w-6xl">
      <header className="mb-8 sm:mb-12">
        <p className="atelier-kicker mb-3">History</p>
        <h1 className="atelier-title">Your archive.</h1>
        <p className="text-muted-foreground mt-3 max-w-xl">
          Every outfit you've analyzed, scored, and saved.
        </p>
      </header>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-card bg-foreground/6" />
          ))}
        </div>
      ) : loadError ? (
        <div className="atelier-card p-10 sm:p-16 text-center">
          <p className="font-serif text-2xl mb-2">Couldn't load your history</p>
          <p className="text-sm text-muted-foreground">Please refresh and try again.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="atelier-card p-10 sm:p-16 text-center">
          <Images className="size-8 mx-auto text-muted-foreground mb-4" strokeWidth={1.25} />
          <p className="font-serif text-2xl mb-2">No outfits yet</p>
          <p className="text-sm text-muted-foreground">Analyzed outfits will be collected here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {items.map((item) => (
            <HistoryCard key={item.id} item={item} onOpen={() => setSelected(item)} />
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent
          className={cn(
            "flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden p-0",
          )}
        >
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4 sm:px-6">
            <DialogTitle className="font-serif text-2xl sm:text-3xl pr-8">
              {selectedAnalysis ? historyItemTitle(selectedAnalysis) : "Saved Look"}
            </DialogTitle>
            {selected ? (
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {new Date(selected.created_at).toLocaleString()}
              </p>
            ) : null}
          </DialogHeader>
          <div className="overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
            {selected && selectedAnalysis ? (
              <HistoryDetailBody item={selected} analysis={selectedAnalysis} />
            ) : null}
          </div>
          {selected && selectedAnalysis ? (
            <div className="shrink-0 border-t border-border px-5 py-3 sm:px-6">
              <Button
                variant="outline"
                className="rounded-full h-10 px-5 uppercase tracking-[0.2em] text-[11px]"
                onClick={() => {
                  openConcierge({
                    lookId: selected.id,
                    imageUrl: selected.image_url,
                    title: historyItemTitle(selectedAnalysis),
                    source: "From History",
                  });
                  setSelected(null);
                }}
              >
                <Sparkles className="size-4 mr-2 text-accent" aria-hidden="true" />
                Ask Mila about this look
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
