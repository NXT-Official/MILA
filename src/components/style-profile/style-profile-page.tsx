import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type StudioColorProfile } from "@/lib/analyzePersonalColor.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { queryKeys } from "@/constants/query-keys";
import { Camera, Loader2, Check } from "lucide-react";
import { ColorDossierSection } from "@/components/studio/style-profile";
import {
  FACE_SHAPES as HOLISTIC_FACE_SHAPES,
  HAIR_TYPES as HOLISTIC_HAIR_TYPES,
} from "@/constants/style-profile";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Season,
  MOOD_COLLECT_DEFAULT,
  type DetailedColorProfile as StudioDossier,
  type BodyType,
  SEASON_HEX_MATRIX,
  SEASONS_MASTER_DATA,
  type StudioTelemetry,
  SEASON_DETAIL,
  SEASON_EDUCATION,
  UNDERTONES,
  SEASONS,
  BODIES,
  FACE_SHORT_TO_FULL,
  FACE_FULL_TO_SHORT,
  CONTRAST_SHORT_TO_FULL,
  CONTRAST_FULL_TO_SHORT,
  BODY_OPTIONS,
  MANUAL_SEASON_GROUPS,
  KNOWN_SEASON_GROUPS,
} from "@/constants/style-profile";
import {
  matrixForSubSeason,
  seasonTone,
  seasonBrightness,
  seasonSaturation,
  splitBeauty,
} from "@/lib/style-profile";
import {
  SyncBadge,
  PerspectiveSwitcher,
  DossierField,
  DossierAccordion,
  PillRow,
  BeautyPillTray,
  CardMatrix,
} from "@/components/style-profile/shared";
import { ColorQuiz } from "@/components/style-profile/color-quiz";
import { BodyTypeQuiz } from "@/components/style-profile/body-type-quiz";
import { VisualDiagnosticViewfinder } from "@/components/style-profile/visual-diagnostic-viewfinder";
import { StudioPortfolioView } from "@/components/style-profile/studio-portfolio-view";
import { studioToDossier, normalizeStoredProfile } from "@/lib/style-profile/studio-dossier";

export function StyleProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    full_name: "",
    skin_undertone: "",
    color_season: "",
    body_type: "",
    selected_aesthetic: "",
  });
  const [holistic, setHolistic] = useState<{ face_shape: string | null; hair_type: string | null }>(
    { face_shape: null, hair_type: null },
  );
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

  const [viewMode, setViewMode] = useState<"streamlined" | "detailed">("streamlined");
  const [beautyPrefs, setBeautyPrefs] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const lastSavedRef = useRef<string>("");
  const initialLoadedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          const json = (data as any).color_profile as any;
          setForm({
            full_name: data.full_name ?? "",
            skin_undertone:
              json?.undertone ?? json?.calculatedUndertone ?? data.skin_undertone ?? "",
            color_season: json?.season ?? data.color_season ?? "",
            body_type: json?.bodyType ?? data.body_type ?? "",
            selected_aesthetic: json?.selectedAesthetic ?? "",
          });
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
          const needsBackfill = (!topFace && resolvedFace) || (!topHair && resolvedHair);
          if (needsBackfill) {
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
              });
          }
          setHolistic({
            face_shape: resolvedFace,
            hair_type: resolvedHair,
          });
          const bp = (data as any).beauty_preferences;
          if (Array.isArray(bp))
            setBeautyPrefs(bp.filter((x): x is string => typeof x === "string"));
          const normalized = normalizeStoredProfile(json);
          if (normalized && !localStudioUpdateRef.current) {
            setDossier(normalized);
            setHasRealDossier(true);
            const matchedGroup = KNOWN_SEASON_GROUPS.find((g) => g.season === normalized.season);
            const matchedTile = matchedGroup?.tiles.find(
              (t) => SEASONS_MASTER_DATA[t.key].subSeason === normalized.subSeason,
            );
            setKnownTileId(matchedTile?.id ?? null);
          }
          const persistedSeason = (json?.season ?? data.color_season) || null;
          lastSavedRef.current = JSON.stringify({
            skin_undertone:
              (json?.undertone ?? json?.calculatedUndertone ?? data.skin_undertone) || null,
            color_season: persistedSeason,
            body_type: (json?.bodyType ?? data.body_type) || null,
            face_shape: resolvedFace,
            hair_type: resolvedHair,
            beauty_preferences: Array.isArray(bp)
              ? bp.filter((x: unknown) => typeof x === "string")
              : [],
          });
          if (persistedSeason) {
            setSyncStatus("synced");
          }
        }
        setLoading(false);
        initialLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function commitManual(over: {
    face?: string;
    contrast?: string;
    season?: string;
    body?: string;
  }) {
    const face = over.face ?? FACE_FULL_TO_SHORT[dossier.faceShape] ?? "Oval";
    const contrast =
      over.contrast ??
      manualContrast ??
      CONTRAST_FULL_TO_SHORT[dossier.contrastScale] ??
      "Medium Contrast";
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
      fullPalette: seasonChanged
        ? matrixForSubSeason(season, `${season} · Studio Tuned`)
        : base.fullPalette,
    };
    const undertone = (["Spring", "Autumn"] as string[]).includes(season) ? "Warm" : "Cool";
    // update, not upsert — see handleStudioComplete for why upsert 403s
    // for accounts whose username is still NULL.
    const { error } = await supabase
      .from("profiles")
      .update({
        color_season: season,
        skin_undertone: undertone,
        body_type: bodyType,
        color_profile: next as any,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", user.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDossier(next);
    setHasRealDossier(true);
    setForm((f) => ({
      ...f,
      color_season: season,
      skin_undertone: f.skin_undertone || undertone,
      body_type: bodyType,
    }));
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile(user.id) });
    toast.success("Saved. Your look is locked in.");
  }

  function pickContrast(v: string) {
    setManualContrast(v);
    void commitManual({ contrast: v });
  }
  function pickSeason(v: string) {
    setManualSeason(v);
    void commitManual({ season: v });
  }
  function pickBody(v: string) {
    setForm((f) => ({ ...f, body_type: v }));
    void commitManual({ body: v });
  }

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
        console.error("[StyleProfile] auto-save FAILED", error, payload);
        setSyncStatus("error");
        return;
      }
      lastSavedRef.current = sig;
      setSyncStatus("synced");
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(user.id) });
    }, 600);
    return () => window.clearTimeout(t);
  }, [
    user,
    form.skin_undertone,
    form.color_season,
    form.body_type,
    holistic.face_shape,
    holistic.hair_type,
    beautyPrefs,
    queryClient,
  ]);

  function toggleBeauty(tag: string) {
    setBeautyPrefs((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  async function handleStudioComplete(p: StudioColorProfile, t?: StudioTelemetry) {
    if (!user) return;
    localStudioUpdateRef.current = true;
    const next = studioToDossier(p, hasRealDossier ? dossier : undefined);
    const undertone = (["Spring", "Autumn"] as string[]).includes(next.season) ? "Warm" : "Cool";

    setDiagOpen(false);
    setManualOpen(false);
    setQuizOpen(false);
    setBodyQuizOpen(false);
    setSyncStatus("syncing");

    const { error } = await supabase
      .from("profiles")
      .update({
        color_season: next.season,
        skin_undertone: undertone,
        body_type: next.bodyType,
        color_profile: next as any,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", user.id);

    if (error) {
      console.error("Studio profile save error:", error);
      setSyncStatus("error");
      toast.error(
        "We couldn't save your color profile. Your selection is still here — try syncing again.",
      );
      return;
    }

    if (t) setTelemetry(t);
    setDossier({ ...next });
    setHasRealDossier(true);
    setProfileRevision((n) => n + 1);
    const updatedSkinUndertone = form.skin_undertone || undertone;
    setForm((f) => ({
      ...f,
      color_season: next.season,
      skin_undertone: updatedSkinUndertone,
      body_type: next.bodyType,
    }));
    // Keep the debounced auto-save effect from immediately re-saving the
    // same values we just persisted above (it watches these same form
    // fields and would otherwise fire a redundant, color_profile-less
    // update 600ms later).
    lastSavedRef.current = JSON.stringify({
      skin_undertone: updatedSkinUndertone || null,
      color_season: next.season || null,
      body_type: next.bodyType || null,
      face_shape: holistic.face_shape,
      hair_type: holistic.hair_type,
      beauty_preferences: beautyPrefs,
    });
    setSyncStatus("synced");
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile(user.id) });

    window.setTimeout(() => {
      portfolioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    toast.success("Your seasonal palette is ready.");
  }

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

  return (
    <div className="bg-[#F5F5F0] text-[#6B6259] dark:bg-background dark:text-muted-foreground min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-12 py-10 md:py-20">
        <header className="mb-12 pb-8 border-b-[0.5px] border-border">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-3">
                <span className="h-px w-8 bg-foreground/60" />
                <p className="atelier-kicker">Digital Style Dossier · Atelier Record</p>
              </div>
              <h1 className="atelier-title mt-4">Your signature blueprint.</h1>
              <p className="text-[11px] uppercase tracking-[0.32em] text-accent font-semibold mt-4">
                A living portrait — kept in sync, automatically.
              </p>
            </div>
            <SyncBadge status={syncStatus} />
          </div>
        </header>
        {loading ? (
          <div className="text-xs tracking-widest text-muted-foreground animate-pulse">
            Loading your profile…
          </div>
        ) : (
          <>
            <div className="mb-10">
              <PerspectiveSwitcher value={viewMode} onChange={setViewMode} />
            </div>
            {form.color_season && (
              <div className="mb-10 space-y-8">
                <ColorDossierSection
                  profile={{ color_season: form.color_season, full_name: form.full_name }}
                />
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
                        <DossierField
                          title="Beauty Preferences"
                          caption="Tap to toggle the finishes you gravitate toward."
                        >
                          <BeautyPillTray active={beautyPrefs} onToggle={toggleBeauty} />
                        </DossierField>
                      </DossierAccordion>
                    </Accordion>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="mb-10">
              <div className="bg-card rounded-card border border-border shadow-paper p-6 sm:p-8">
                <div className="text-center">
                  <p className="atelier-kicker">Path 01 · Know Your Season</p>
                  <h2 className="font-serif text-2xl sm:text-3xl tracking-tight mt-2">
                    Select Your Known Color Profile
                  </h2>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-2 max-w-md mx-auto">
                    Already know your seasonal palette? Tap your look below and confirm — your
                    palette loads instantly, no camera needed.
                  </p>
                </div>
                <div className="mt-8 space-y-7">
                  {KNOWN_SEASON_GROUPS.map((group) => (
                    <div key={group.season}>
                      <div className="flex items-center gap-3">
                        <span className="h-px w-6 bg-foreground/30" />
                        <p className="text-[10px] uppercase tracking-[0.42em] text-foreground/70">
                          {group.season}
                        </p>
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
                              style={
                                active ? undefined : { backgroundColor: groupTint[group.season] }
                              }
                              className={`group text-left border px-3 py-3 transition-all min-h-17 ${
                                active
                                  ? "border-foreground bg-foreground/4 -translate-y-px ring-1 ring-foreground"
                                  : "border-border hover:border-foreground/40"
                              }`}
                            >
                              <p className="text-[11px] uppercase tracking-[0.22em] text-foreground flex items-center justify-between gap-2">
                                <span>{tile.label}</span>
                                {active && <Check className="size-3" />}
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
                      const tile = KNOWN_SEASON_GROUPS.flatMap((g) => g.tiles).find(
                        (t) => t.id === knownTileId,
                      );
                      if (!tile) return;
                      setConfirmingKnown(true);
                      try {
                        await applyDashboardCalibration(tile.key, tile.label);
                      } finally {
                        setConfirmingKnown(false);
                      }
                    }}
                  >
                    {confirmingKnown ? (
                      <Loader2 className="size-3.5 mr-2 animate-spin" />
                    ) : (
                      <Check className="size-3.5 mr-2" />
                    )}
                    Confirm Selection
                  </Button>
                  <p className="mt-3 text-[10px] uppercase tracking-[0.28em] text-accent text-center">
                    {knownTileId
                      ? "Loads from our atelier library · Saved to your profile"
                      : "Select a season above to confirm."}
                  </p>
                </div>
              </div>

              <div className="mt-8">
                <Accordion
                  type="single"
                  collapsible
                  className="bg-card rounded-card border border-border shadow-paper"
                >
                  <AccordionItem value="studio-camera" className="border-b-0">
                    <AccordionTrigger className="px-6 sm:px-8 py-5 hover:no-underline">
                      <div className="flex flex-col items-start text-left">
                        <p className="atelier-kicker">Path 02 · Discover Your Season</p>
                        <p className="font-serif text-lg sm:text-xl tracking-tight mt-1">
                          Not sure of your season? Let's find it together.
                        </p>
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
                          <Camera className="size-3.5 mr-2" />
                          Open the camera
                        </Button>
                        <button
                          onClick={() => setManualOpen((v) => !v)}
                          className="mt-4 text-[10px] uppercase tracking-[0.28em] text-accent hover:text-foreground transition-colors underline-offset-4 hover:underline"
                        >
                          {manualOpen ? "Hide manual override" : "Or set your season by hand"}
                        </button>
                      </div>
                      {manualOpen && (
                        <div className="mt-6 animate-fade-in space-y-8 px-1 sm:px-2">
                          <div className="bg-card p-8 rounded-card border border-border shadow-paper max-w-2xl mx-auto space-y-8">
                            <div className="text-center space-y-2">
                              <span className="text-[0.18em] uppercase tracking-[0.3em] text-stone text-xs block">
                                Private Consultation
                              </span>
                              <h3 className="font-serif text-2xl text-ink tracking-wide">
                                Determine Your Seasonal Palette
                              </h3>
                              <p className="text-sm text-stone max-w-md mx-auto">
                                Aligning the natural undertones of your skin, hair, and eyes with
                                curated textile seasons.
                              </p>
                            </div>
                            <div className="space-y-6">
                              <div className="space-y-3">
                                <label className="text-xs uppercase tracking-[0.2em] text-ink font-medium block">
                                  Your Prevailing Season
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                  {[
                                    {
                                      id: "Spring",
                                      title: "The Spring Awakening",
                                      desc: "Warm, luminous, clear, vivid gold undertones",
                                    },
                                    {
                                      id: "Summer",
                                      title: "The Muted Summer",
                                      desc: "Cool, soft, ethereal, delicate slate and rose hues",
                                    },
                                    {
                                      id: "Autumn",
                                      title: "The Rich Autumn",
                                      desc: "Deep, warm, earthy, sun-drenched ochre tones",
                                    },
                                    {
                                      id: "Winter",
                                      title: "The Vivid Winter",
                                      desc: "Sharp, cool, striking contrast, clear jewel profiles",
                                    },
                                  ].map((season) => {
                                    const active = manualSeason === season.id;
                                    return (
                                      <button
                                        key={season.id}
                                        type="button"
                                        onClick={() => pickSeason(season.id)}
                                        className={`p-4 text-left rounded-xl border transition-all duration-300 group ${active ? "bg-surface dark:bg-secondary border-stone/40 shadow-atelier-soft" : "border-stone/10 bg-porcelain/30 hover:bg-surface dark:hover:bg-secondary hover:border-stone/30 hover:shadow-atelier-soft"}`}
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
                                <p className="text-xs text-stone mb-2">
                                  The relationship between the intensity of your features and
                                  textiles.
                                </p>
                                <div className="grid grid-cols-3 gap-2">
                                  {[
                                    {
                                      id: "Low Contrast",
                                      name: "Soft & Blended",
                                      sub: "Subtle transitions",
                                    },
                                    {
                                      id: "Medium Contrast",
                                      name: "Balanced Depth",
                                      sub: "Classic equilibrium",
                                    },
                                    {
                                      id: "High Contrast",
                                      name: "Striking Contrast",
                                      sub: "High-drama definition",
                                    },
                                  ].map((contrast) => {
                                    const active = manualContrast === contrast.id;
                                    return (
                                      <button
                                        key={contrast.id}
                                        type="button"
                                        onClick={() => pickContrast(contrast.id)}
                                        className={`p-3 text-center rounded-lg border transition-all duration-300 ${active ? "bg-surface dark:bg-secondary border-stone/40 shadow-atelier-soft" : "border-stone/10 bg-porcelain/20 hover:bg-surface dark:hover:bg-secondary"}`}
                                      >
                                        <span className="text-xs uppercase tracking-wider font-semibold text-ink block">
                                          {contrast.name}
                                        </span>
                                        <span className="text-[10px] text-stone mt-0.5 block">
                                          {contrast.sub}
                                        </span>
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
            {quizOpen && (
              <ColorQuiz
                onClose={() => setQuizOpen(false)}
                onComplete={({ season, undertone, profile }) =>
                  setForm((f) => ({
                    ...f,
                    skin_undertone: undertone,
                    color_season: season,
                    selected_aesthetic: profile.selectedAesthetic || f.selected_aesthetic,
                  }))
                }
                userId={user?.id}
              />
            )}
            {bodyQuizOpen && (
              <BodyTypeQuiz
                onClose={() => setBodyQuizOpen(false)}
                onComplete={(bodyType) => setForm((f) => ({ ...f, body_type: bodyType }))}
                userId={user?.id}
              />
            )}
            {diagOpen && (
              <VisualDiagnosticViewfinder
                onClose={() => setDiagOpen(false)}
                onComplete={handleStudioComplete}
              />
            )}
            <div ref={portfolioRef}>
              <StudioPortfolioView
                key={
                  hasRealDossier
                    ? `live-${profileRevision}-${dossier.season}-${dossier.subSeason}`
                    : "demo"
                }
                profile={dossier}
                isDemo={!hasRealDossier}
                telemetry={telemetry}
              />
            </div>
            {hasRealDossier && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <span className="h-px w-10 bg-foreground/20" />
                <button
                  type="button"
                  onClick={() => setDashCalibrateOpen(true)}
                  className="text-[10px] uppercase tracking-[0.42em] text-accent hover:text-foreground transition-colors underline-offset-[6px] hover:underline"
                >
                  Fine-tune your palette
                </button>
                <span className="h-px w-10 bg-foreground/20" />
              </div>
            )}
            <Sheet open={dashCalibrateOpen} onOpenChange={setDashCalibrateOpen}>
              <SheetContent
                side="bottom"
                className="bg-ink text-surface border-t border-surface/10 rounded-t-2xl max-h-[85vh] overflow-y-auto"
              >
                <SheetHeader className="text-left">
                  <p className="text-[9px] uppercase tracking-[0.42em] text-surface/50">
                    Seoul Atelier
                  </p>
                  <SheetTitle className="font-serif text-2xl tracking-tight text-surface">
                    Already know your seasonal palette? Choose your look below.
                  </SheetTitle>
                  <SheetDescription className="text-[11px] text-surface/60 leading-relaxed">
                    Cameras can read light and shadow differently than the eye. Tap your true
                    sub-season — your palette, beauty notes, and colors to avoid will update from
                    the atelier library, and your confidence chip will lock to 100% Studio Tuned.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-7 pb-6">
                  {MANUAL_SEASON_GROUPS.map((group) => (
                    <div key={group.season}>
                      <div className="flex items-center gap-3">
                        <span className="h-px w-6 bg-surface/30" />
                        <p className="text-[10px] uppercase tracking-[0.38em] text-surface/70">
                          {group.season}
                        </p>
                      </div>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {group.keys.map((k) => {
                          const active =
                            dossier.season === group.season &&
                            SEASONS_MASTER_DATA[k.key].subSeason === dossier.subSeason;
                          return (
                            <button
                              key={k.key}
                              type="button"
                              onClick={() => void applyDashboardCalibration(k.key, k.label)}
                              className={`group text-left border px-4 py-3 transition-colors ${
                                active
                                  ? "border-surface bg-surface/10"
                                  : "border-surface/15 hover:border-surface/60 bg-surface/2 hover:bg-surface/6"
                              }`}
                            >
                              <p className="text-[11px] uppercase tracking-[0.22em] text-surface flex items-center justify-between gap-2">
                                {k.label}
                                {active && <Check className="size-3 text-surface/80" />}
                              </p>
                              <p className="mt-1 text-[10px] text-surface/55 leading-relaxed line-clamp-2">
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
