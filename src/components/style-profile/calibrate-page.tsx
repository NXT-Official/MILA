import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Camera, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/constants/query-keys";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  type Season,
  MOOD_COLLECT_DEFAULT,
  type DetailedColorProfile as StudioDossier,
  type BodyType,
  SEASON_HEX_MATRIX,
  SEASONS_MASTER_DATA,
  SEASON_DETAIL,
  SEASON_EDUCATION,
  FACE_SHORT_TO_FULL,
  FACE_FULL_TO_SHORT,
  CONTRAST_SHORT_TO_FULL,
  CONTRAST_FULL_TO_SHORT,
  BODY_OPTIONS,
  KNOWN_SEASON_GROUPS,
  ATELIER_PROVENANCE,
} from "@/constants/style-profile";
import {
  matrixForSubSeason,
  seasonTone,
  seasonBrightness,
  seasonSaturation,
  splitBeauty,
} from "@/lib/style-profile";
import { SectionHeader, CardMatrix } from "@/components/style-profile/shared";
import { VisualDiagnosticViewfinder } from "@/components/style-profile/visual-diagnostic-viewfinder";
import { studioToDossier, normalizeStoredProfile } from "@/lib/style-profile/studio-dossier";
import type { StudioColorProfile } from "@/lib/analyzePersonalColor.functions";

const GROUP_TINT: Record<string, string> = {
  Spring: "#FFF5F0",
  Summer: "#F5F0FF",
  Autumn: "#FFF8F0",
  Winter: "#F0F5FF",
};

/**
 * Every input that decides a season lives here. The dossier is an output view —
 * it links in, it does not host the picker.
 */
export function CalibratePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [dossier, setDossier] = useState<StudioDossier>(MOOD_COLLECT_DEFAULT);
  const [hasRealDossier, setHasRealDossier] = useState(false);
  const [bodyType, setBodyType] = useState("");
  const [knownTileId, setKnownTileId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSeason, setManualSeason] = useState("");
  const [manualContrast, setManualContrast] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("body_type,color_profile")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setBodyType(data?.body_type ?? "");
        const normalized = normalizeStoredProfile(data?.color_profile);
        if (normalized) {
          setDossier(normalized);
          setHasRealDossier(true);
          setManualSeason(normalized.season);
          const group = KNOWN_SEASON_GROUPS.find((g) => g.season === normalized.season);
          const tile = group?.tiles.find(
            (t) => SEASONS_MASTER_DATA[t.key].subSeason === normalized.subSeason,
          );
          setKnownTileId(tile?.id ?? null);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function saveDossier(next: StudioDossier) {
    if (!user) return false;
    const undertone = (["Spring", "Autumn"] as string[]).includes(next.season) ? "Warm" : "Cool";
    const { error } = await supabase
      .from("profiles")
      .update({
        color_season: next.season,
        skin_undertone: undertone,
        body_type: next.bodyType,
        color_profile: next as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    setDossier(next);
    setHasRealDossier(true);
    setBodyType(next.bodyType);
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile(user.id) });
    return true;
  }

  /** Season, contrast or silhouette changed by hand — rebuild the palette around it. */
  async function commitManual(over: { contrast?: string; season?: string; body?: string }) {
    const face = FACE_FULL_TO_SHORT[dossier.faceShape] ?? "Oval";
    const contrast =
      over.contrast ??
      manualContrast ??
      CONTRAST_FULL_TO_SHORT[dossier.contrastScale] ??
      "Medium Contrast";
    const seasonStr = over.season ?? manualSeason ?? dossier.season;
    const bodyStr = over.body ?? bodyType ?? dossier.bodyType;
    if (!user || !contrast || !seasonStr || !bodyStr) return;
    const season = seasonStr as Season;
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
      bodyType: bodyStr as BodyType,
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
      fullPalette: seasonChanged
        ? matrixForSubSeason(season, `${season} · Studio Tuned`)
        : base.fullPalette,
    };
    if (await saveDossier(next)) toast.success("Saved. Your palette is updated.");
  }

  /** The camera diagnostic finished — its reading becomes the dossier. */
  async function handleStudioComplete(p: StudioColorProfile) {
    setDiagOpen(false);
    const next = studioToDossier(p, hasRealDossier ? dossier : undefined);
    if (await saveDossier(next)) {
      toast.success("Your seasonal palette is ready.");
      void navigate({ to: "/profile" });
    }
  }

  /** A hand-picked sub-season loads straight from the atelier library. */
  async function applyKnownTile(key: keyof typeof SEASONS_MASTER_DATA) {
    const spec = SEASONS_MASTER_DATA[key];
    await handleStudioComplete({
      ...spec,
      faceShape: dossier.faceShape ?? "Oval Frame",
      bodyType: dossier.bodyType ?? "Hourglass",
      stylistNote: ATELIER_PROVENANCE,
      fullPalette: SEASON_HEX_MATRIX[key],
      detectedLighting: "Manual Studio Calibration",
      calculatedUndertone: spec.toneType,
      confidenceScore: 100,
    });
  }

  return (
    <div className="min-h-screen bg-background text-muted-foreground">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-24">
        <Link
          to="/profile"
          className="atelier-focus-ring inline-flex items-center gap-1.5 rounded-control text-micro uppercase tracking-label-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to dossier
        </Link>

        <div className="mt-6 space-y-8">
          <SectionHeader
            title="Set your season"
            subtitle={
              hasRealDossier
                ? `Currently ${dossier.subSeason}. Pick another below and your palette updates everywhere.`
                : "Pick the season you know, or let the camera read your tones."
            }
          />

          {loading ? (
            <p className="text-xs tracking-widest text-muted-foreground animate-pulse">Loading…</p>
          ) : (
            <>
              <section className="rounded-card border-[0.5px] border-border bg-card p-6 shadow-paper sm:p-8">
                <p className="atelier-kicker">Path 01 · You know your season</p>
                <div className="mt-6 space-y-7">
                  {KNOWN_SEASON_GROUPS.map((group) => (
                    <div key={group.season}>
                      <div className="flex items-center gap-3">
                        <span className="h-px w-6 bg-foreground/30" />
                        <p className="text-micro uppercase tracking-label-max text-foreground/70">
                          {group.season}
                        </p>
                        <span className="h-px flex-1 bg-foreground/10" />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {group.tiles.map((tile) => {
                          const active = knownTileId === tile.id;
                          return (
                            <button
                              key={tile.id}
                              type="button"
                              onClick={() => setKnownTileId(tile.id)}
                              style={
                                active ? undefined : { backgroundColor: GROUP_TINT[group.season] }
                              }
                              className={`group min-h-17 rounded-xl border px-3 py-3 text-left transition-all ${
                                active
                                  ? "border-foreground bg-foreground/4 -translate-y-px ring-1 ring-foreground"
                                  : "border-border hover:border-foreground/40"
                              }`}
                            >
                              <p className="flex items-center justify-between gap-2 text-label uppercase tracking-label-wide">
                                <span>{tile.label}</span>
                                {active && <Check className="size-3" />}
                              </p>
                              <p className="mt-1 text-micro leading-relaxed text-muted-foreground">
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
                    disabled={!knownTileId || confirming}
                    size="md"
                    className="w-full px-8 sm:w-auto"
                    onClick={async () => {
                      const tile = KNOWN_SEASON_GROUPS.flatMap((g) => g.tiles).find(
                        (t) => t.id === knownTileId,
                      );
                      if (!tile) return;
                      setConfirming(true);
                      try {
                        await applyKnownTile(tile.key);
                      } finally {
                        setConfirming(false);
                      }
                    }}
                  >
                    {confirming ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Check aria-hidden="true" />
                    )}
                    Save season
                  </Button>
                  <p className="mt-3 text-center text-micro uppercase tracking-label-xwide text-accent">
                    {knownTileId ? ATELIER_PROVENANCE : "Pick a season above to save."}
                  </p>
                </div>
              </section>

              <Accordion
                type="single"
                collapsible
                className="rounded-card border-[0.5px] border-border bg-card shadow-paper"
              >
                <AccordionItem value="camera" className="border-b-0">
                  <AccordionTrigger className="px-6 py-5 hover:no-underline sm:px-8">
                    <div className="flex flex-col items-start text-left">
                      <p className="atelier-kicker">Path 02 · Not sure yet</p>
                      <p className="mt-1 font-serif text-lg tracking-tight sm:text-xl">
                        Let&rsquo;s find your season together.
                      </p>
                      <p className="mt-1 text-label leading-relaxed text-muted-foreground">
                        Find good light and Mila reads your tones live.
                      </p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-8 sm:px-8">
                    <div className="flex flex-col items-center pt-2 text-center">
                      <Button
                        size="md"
                        className="w-full px-8 sm:w-auto"
                        onClick={() => setDiagOpen(true)}
                      >
                        <Camera aria-hidden="true" />
                        Open the camera
                      </Button>
                      <button
                        onClick={() => setManualOpen((v) => !v)}
                        className="mt-4 text-micro uppercase tracking-label-xwide text-accent underline-offset-4 transition-colors hover:text-foreground hover:underline"
                      >
                        {manualOpen ? "Hide manual override" : "Or set your season by hand"}
                      </button>
                    </div>
                    {manualOpen && (
                      <div className="mt-6 space-y-8">
                        <div className="space-y-3">
                          <p className="text-xs uppercase tracking-label text-ink">
                            Your prevailing season
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            {SEASON_CARDS.map((season) => {
                              const active = manualSeason === season.id;
                              return (
                                <button
                                  key={season.id}
                                  type="button"
                                  onClick={() => {
                                    setManualSeason(season.id);
                                    void commitManual({ season: season.id });
                                  }}
                                  className={`group rounded-xl border p-4 text-left transition-all duration-300 ${
                                    active
                                      ? "border-stone/40 bg-surface shadow-atelier-soft dark:bg-secondary"
                                      : "border-stone/10 bg-porcelain/30 hover:border-stone/30 hover:bg-surface hover:shadow-atelier-soft dark:hover:bg-secondary"
                                  }`}
                                >
                                  <span className="block font-serif text-base text-ink transition-colors group-hover:text-rose">
                                    {season.title}
                                  </span>
                                  <span className="mt-1 block text-xs leading-relaxed text-stone">
                                    {season.desc}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="space-y-3 border-t border-porcelain/30 pt-4">
                          <p className="text-xs uppercase tracking-label text-ink">
                            Depth of contrast
                          </p>
                          <p className="mb-2 text-xs text-stone">
                            How sharply your features read against your clothes.
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            {CONTRAST_CARDS.map((contrast) => {
                              const active = manualContrast === contrast.id;
                              return (
                                <button
                                  key={contrast.id}
                                  type="button"
                                  onClick={() => {
                                    setManualContrast(contrast.id);
                                    void commitManual({ contrast: contrast.id });
                                  }}
                                  className={`rounded-lg border p-3 text-center transition-all duration-300 ${
                                    active
                                      ? "border-stone/40 bg-surface shadow-atelier-soft dark:bg-secondary"
                                      : "border-stone/10 bg-porcelain/20 hover:bg-surface dark:hover:bg-secondary"
                                  }`}
                                >
                                  <span className="block text-xs font-semibold uppercase tracking-wider text-ink">
                                    {contrast.name}
                                  </span>
                                  <span className="mt-0.5 block text-micro text-stone">
                                    {contrast.sub}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <CardMatrix
                          label="Your silhouette"
                          value={bodyType}
                          onPick={(v) => {
                            setBodyType(v);
                            void commitManual({ body: v });
                          }}
                          options={BODY_OPTIONS}
                        />
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </>
          )}
        </div>

        {diagOpen && (
          <VisualDiagnosticViewfinder
            onClose={() => setDiagOpen(false)}
            onComplete={handleStudioComplete}
          />
        )}
      </div>
    </div>
  );
}

const SEASON_CARDS = [
  { id: "Spring", title: "Spring", desc: "Warm, clear, luminous — gold undertones." },
  { id: "Summer", title: "Summer", desc: "Cool and soft — slate and rose, low contrast." },
  { id: "Autumn", title: "Autumn", desc: "Warm and earthy — ochre, olive, rust." },
  { id: "Winter", title: "Winter", desc: "Cool and sharp — jewel tones, high contrast." },
];

const CONTRAST_CARDS = [
  { id: "Low Contrast", name: "Soft", sub: "Blended" },
  { id: "Medium Contrast", name: "Balanced", sub: "Classic" },
  { id: "High Contrast", name: "Striking", sub: "High drama" },
];
