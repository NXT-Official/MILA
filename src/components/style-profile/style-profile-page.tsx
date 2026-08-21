import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { queryKeys } from "@/constants/query-keys";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FACE_SHAPES as HOLISTIC_FACE_SHAPES,
  HAIR_TYPES as HOLISTIC_HAIR_TYPES,
} from "@/constants/style-profile";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Accordion } from "@/components/ui/accordion";
import {
  type Season,
  MOOD_COLLECT_DEFAULT,
  type DetailedColorProfile as StudioDossier,
  BODIES,
  STYLE_GOALS,
  STYLE_GOAL_LIMIT,
  SEASON_ONE_LINER,
  SILHOUETTE_STRATEGY,
  HAIR_DIRECTION,
  MAKEUP_HARMONY,
  TEXTILE_DIRECTION,
  NAMED_PALETTE,
  ATELIER_PROVENANCE,
} from "@/constants/style-profile";
import { matrixForSubSeason } from "@/lib/style-profile";
import {
  SyncBadge,
  DossierTopBar,
  SectionHeader,
  DetailChip,
  DNACard,
  PaletteBand,
  MissingDetailsNudge,
  PerspectiveSwitcher,
  DossierField,
  DossierAccordion,
  PillRow,
  BeautyPillTray,
} from "@/components/style-profile/shared";
import { AttributeDiagram } from "@/components/style-profile/diagrams";
import { normalizeStoredProfile } from "@/lib/style-profile/studio-dossier";
import { combosFor } from "@/lib/style-profile/outfit-combos";

function readString(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export function StyleProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
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
  const [dossier, setDossier] = useState<StudioDossier>(MOOD_COLLECT_DEFAULT);
  const [hasRealDossier, setHasRealDossier] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const [viewMode, setViewMode] = useState<"streamlined" | "detailed">("streamlined");
  const [beautyPrefs, setBeautyPrefs] = useState<string[]>([]);
  const [styleGoals, setStyleGoals] = useState<string[]>([]);
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
          const json =
            data.color_profile &&
            typeof data.color_profile === "object" &&
            !Array.isArray(data.color_profile)
              ? data.color_profile
              : {};
          setForm({
            full_name: data.full_name ?? "",
            skin_undertone:
              readString(json.undertone) ??
              readString(json.calculatedUndertone) ??
              data.skin_undertone ??
              "",
            color_season: readString(json.season) ?? data.color_season ?? "",
            body_type: readString(json.bodyType) ?? data.body_type ?? "",
            selected_aesthetic: readString(json.selectedAesthetic) ?? "",
          });
          const topFace = data.face_shape;
          const topHair = data.hair_type;
          const jbFaceRaw = readString(json.faceShape);
          const jbHairRaw = readString(json.hairType) ?? readString(json.hair_type);
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
          const bp = data.beauty_preferences;
          if (Array.isArray(bp))
            setBeautyPrefs(bp.filter((x): x is string => typeof x === "string"));
          if (Array.isArray(data.style_goals))
            setStyleGoals(data.style_goals.filter((x): x is string => typeof x === "string"));
          const normalized = normalizeStoredProfile(json);
          if (normalized) {
            setDossier(normalized);
            setHasRealDossier(true);
          }
          const persistedSeason = readString(json.season) ?? data.color_season;
          lastSavedRef.current = JSON.stringify({
            body_type: (json?.bodyType ?? data.body_type) || null,
            face_shape: resolvedFace,
            hair_type: resolvedHair,
            beauty_preferences: Array.isArray(bp)
              ? bp.filter((x: unknown) => typeof x === "string")
              : [],
            style_goals: Array.isArray(data.style_goals) ? data.style_goals : [],
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

  // Season and undertone are set on /calibrate, so they are deliberately absent
  // from this payload — the dossier must not write back a stale copy of them.
  useEffect(() => {
    if (!user || !initialLoadedRef.current) return;
    const payload = {
      body_type: form.body_type || null,
      face_shape: holistic.face_shape,
      hair_type: holistic.hair_type,
      beauty_preferences: beautyPrefs,
      style_goals: styleGoals,
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
    form.body_type,
    holistic.face_shape,
    holistic.hair_type,
    beautyPrefs,
    styleGoals,
    queryClient,
  ]);

  function goToCalibrate() {
    void navigate({ to: "/calibrate" });
  }

  function toggleGoal(goal: string) {
    setStyleGoals((prev) =>
      prev.includes(goal)
        ? prev.filter((g) => g !== goal)
        : prev.length >= STYLE_GOAL_LIMIT
          ? prev
          : [...prev, goal],
    );
  }

  function toggleBeauty(tag: string) {
    setBeautyPrefs((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // The goals live in the streamlined view, so the chip has to switch back to it
  // before scrolling — the element does not exist while Detailed is mounted.
  function goToStyleGoals() {
    setViewMode("streamlined");
    requestAnimationFrame(() =>
      document
        .getElementById("style-goal-section")
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }

  // The four-family palette the DNA cards and bands read from.
  const family: Season = ((form.color_season || dossier.season) as Season) ?? "Summer";
  const namedPalette = NAMED_PALETTE[family] ?? NAMED_PALETTE.Summer;
  const masterPalette = dossier.fullPalette ?? matrixForSubSeason(family, dossier.subSeason);
  const combos = combosFor(family);

  // Hero copy: the tuned sub-season when there is a real dossier, the plain
  // season otherwise, and nothing invented when neither exists yet.
  const heroSeasonName = hasRealDossier ? dossier.subSeason : form.color_season || "Season not set";
  const heroSeasonLine =
    hasRealDossier || form.color_season
      ? (SEASON_ONE_LINER[family] ?? "Every look below is composed against this palette.")
      : "Set your season and Mila builds your palette from it.";

  return (
    <div className="min-h-screen bg-background text-muted-foreground">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-24">
        <DossierTopBar counterpart="studio" />
        <div className="mt-4 mb-6 flex items-center justify-between gap-4">
          <p className="atelier-kicker">Digital Style Dossier</p>
          <SyncBadge status={syncStatus} />
        </div>
        {loading ? (
          // Skeleton in the shape of what is coming, so the page does not
          // reflow when it arrives.
          <div className="space-y-10" aria-busy="true" aria-label="Loading your dossier">
            <div className="rounded-card border-[0.5px] border-border bg-card p-6 shadow-paper">
              <div className="flex flex-col items-center gap-4">
                <div className="size-28 animate-pulse rounded-full bg-muted" />
                <div className="h-8 w-48 animate-pulse rounded-control bg-muted" />
                <div className="h-4 w-64 animate-pulse rounded-control bg-muted" />
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="h-[4.5rem] animate-pulse rounded-control bg-muted" />
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div className="h-7 w-40 animate-pulse rounded-control bg-muted" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <div
                    key={i}
                    className="size-19 animate-pulse rounded-control bg-muted sm:size-20"
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            {/* HERO — PERSONAL SEASON */}
            <section className="rounded-card border-[0.5px] border-border bg-card p-6 shadow-paper">
              <p className="text-center text-label uppercase tracking-label text-muted-foreground">
                Your Personal Season
              </p>

              <div className="mt-5 flex flex-col items-center gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-28 items-center justify-center rounded-full bg-ink font-serif text-4xl text-surface ring-1 ring-accent/50 ring-offset-4 ring-offset-card"
                >
                  {(form.full_name || user?.email || "M")[0]?.toUpperCase()}
                </span>
                <div className="text-center">
                  <h1 className="font-serif text-3xl leading-tight tracking-tight text-foreground">
                    {heroSeasonName}
                  </h1>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    {heroSeasonLine}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {/* These three are read off the calibration, so an unset one
                    points at /calibrate rather than dead-ending. */}
                <DetailChip
                  label="Undertone"
                  value={form.skin_undertone || null}
                  onAdd={goToCalibrate}
                />
                <DetailChip
                  label="Skin Lightness"
                  value={hasRealDossier ? dossier.brightness : null}
                  onAdd={goToCalibrate}
                />
                <DetailChip
                  label="Contrast"
                  value={hasRealDossier ? dossier.contrastScale : null}
                  onAdd={goToCalibrate}
                />
                <DetailChip
                  label="Silhouette"
                  value={form.body_type || null}
                  onAdd={() => setViewMode("detailed")}
                  diagram={<AttributeDiagram kind="silhouette" value={form.body_type} />}
                />
                <DetailChip
                  label="Face Shape"
                  value={holistic.face_shape}
                  onAdd={() => setViewMode("detailed")}
                  diagram={<AttributeDiagram kind="face" value={holistic.face_shape} />}
                />
                <DetailChip
                  label="Hair Texture"
                  value={holistic.hair_type}
                  onAdd={() => setViewMode("detailed")}
                  diagram={<AttributeDiagram kind="hair" value={holistic.hair_type} />}
                />
                <DetailChip
                  label="Beauty"
                  value={beautyPrefs[0] ?? null}
                  onAdd={() => setViewMode("detailed")}
                />
                <DetailChip
                  label="Style Goal"
                  value={styleGoals[0] ?? null}
                  onAdd={goToStyleGoals}
                />
              </div>

              {/* The one way into the season picker. Calibration is an input; it
                  lives on its own screen instead of interrupting this one. */}
              <div className="mt-6 flex justify-center">
                <Link
                  to="/calibrate"
                  className="atelier-focus-ring inline-flex min-h-11 items-center rounded-control text-label uppercase tracking-label text-accent-ink underline-offset-[6px] transition-colors hover:text-foreground hover:underline"
                >
                  {hasRealDossier || form.color_season ? "Change my season" : "Set my season"} →
                </Link>
              </div>
            </section>

            {/* COLOUR — the only place colour is named. */}
            <section className="space-y-4">
              <SectionHeader
                title="Your Palette"
                subtitle="Tap any swatch for its name and where to wear it."
              />
              <div className="space-y-5">
                <PaletteBand label="Primary tones" swatches={namedPalette.primary} />
                <PaletteBand label="Accents" swatches={namedPalette.accents} />
                <PaletteBand label="Neutrals" swatches={namedPalette.neutrals} />
                <PaletteBand label="Colours to avoid" swatches={namedPalette.avoid} tone="avoid" />
              </div>
            </section>

            {combos.length > 0 && (
              <section className="space-y-4">
                <SectionHeader title="Colour Combinations to Try" />
                <div className="grid gap-3 sm:grid-cols-2">
                  {combos.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-card border-[0.5px] border-border bg-card p-4 transition-shadow hover:shadow-paper"
                    >
                      <div className="flex overflow-hidden rounded-lg" aria-hidden="true">
                        {c.hexes.map((hex, i) => (
                          <div
                            key={`${c.id}-${hex}-${i}`}
                            className="h-14 flex-1"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                      <p className="mt-3 text-label uppercase tracking-label text-muted-foreground">
                        {c.names.join(" · ")}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-foreground/85">
                        &ldquo;{c.note}&rdquo;
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ACTIONS — what to do about it. No colour names, no season name. */}
            <section className="space-y-4">
              <SectionHeader
                title="Mila&rsquo;s Styling Notes"
                subtitle={hasRealDossier ? ATELIER_PROVENANCE : undefined}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DNACard
                  title="Silhouette Strategy"
                  directive={SILHOUETTE_STRATEGY[form.body_type]}
                  rationale={{ label: "silhouette", value: form.body_type }}
                  fallback="Add your silhouette below and this becomes specific."
                  action={
                    form.body_type
                      ? undefined
                      : { label: "Add silhouette", onClick: () => setViewMode("detailed") }
                  }
                />
                <DNACard
                  title="Hair Direction"
                  directive={HAIR_DIRECTION[holistic.hair_type ?? ""]}
                  rationale={{ label: "hair texture", value: holistic.hair_type }}
                  fallback="Add your hair texture below to unlock this."
                  action={
                    holistic.hair_type
                      ? undefined
                      : { label: "Add hair texture", onClick: () => setViewMode("detailed") }
                  }
                />
                {/* No season name here — the hero states it, and this section
                    owns actions only. */}
                <DNACard
                  title="Makeup Harmony"
                  directive={MAKEUP_HARMONY[family]}
                  rationale={{ label: "palette" }}
                />
                <DNACard
                  title="Textile Direction"
                  directive={TEXTILE_DIRECTION[family]}
                  rationale={{ label: "palette" }}
                />
              </div>
            </section>

            <div>
              <PerspectiveSwitcher value={viewMode} onChange={setViewMode} />
            </div>

            <div>
              <AnimatePresence mode="wait" initial={false}>
                {viewMode === "streamlined" ? (
                  <motion.div
                    key="streamlined"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: reduce ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-10"
                  >
                    <MissingDetailsNudge
                      missing={[
                        holistic.face_shape ? null : "Face shape",
                        holistic.hair_type ? null : "Hair texture",
                      ].filter((v): v is string => v !== null)}
                      onOpenDetailed={() => setViewMode("detailed")}
                    />
                    <DossierField
                      title="Body Silhouette"
                      caption="Sets the cuts, drape and proportions Mila suggests."
                    >
                      <PillRow
                        value={form.body_type}
                        options={BODIES as unknown as string[]}
                        onSelect={(v) => setForm((f) => ({ ...f, body_type: v }))}
                      />
                    </DossierField>
                    <DossierField
                      title="Hair Texture"
                      caption="Shapes the hair notes in every look."
                    >
                      <PillRow
                        value={holistic.hair_type}
                        options={HOLISTIC_HAIR_TYPES as unknown as string[]}
                        onSelect={(v) => setHolistic((h) => ({ ...h, hair_type: v }))}
                      />
                    </DossierField>
                    <DossierField
                      id="style-goal-section"
                      title="What are you working toward?"
                      caption={`Pick up to ${STYLE_GOAL_LIMIT}. They save as you tap.`}
                    >
                      <BeautyPillTray
                        active={styleGoals}
                        onToggle={toggleGoal}
                        tags={STYLE_GOALS}
                        limit={STYLE_GOAL_LIMIT}
                      />
                    </DossierField>
                  </motion.div>
                ) : (
                  <motion.div
                    key="detailed"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: reduce ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {/* Season and undertone are not here: they are set on
                        /calibrate and read back in the hero. */}
                    <Accordion type="multiple" defaultValue={["01"]} className="space-y-4">
                      <DossierAccordion
                        value="01"
                        title="Frame"
                        caption="Silhouette and face shape — the structure behind every cut."
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
                        value="02"
                        title="Beauty & Texture"
                        caption="Hair texture and the finishes you gravitate toward."
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
            <section>
              <button
                type="button"
                onClick={() => setArchiveOpen((v) => !v)}
                aria-expanded={archiveOpen}
                className="atelier-focus-ring flex w-full items-center justify-between rounded-card border-[0.5px] border-border bg-surface/40 px-5 py-4 text-left"
              >
                <div>
                  <p className="font-serif text-lg text-foreground">Full colour matrix</p>
                  <p className="text-sm text-muted-foreground">
                    Every hex in your palette, for shopping and mood boards.
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    archiveOpen && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </button>
              <AnimatePresence initial={false}>
                {archiveOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    {masterPalette.length > 0 && (
                      <div className="mt-3 space-y-4 rounded-card border-[0.5px] border-border bg-card p-5">
                        <p className="text-sm text-muted-foreground">
                          Your full {masterPalette.length}-hex master palette. Useful for shopping
                          references and mood boards.
                        </p>
                        <div className="grid grid-cols-10 gap-1">
                          {masterPalette.map((hex, i) => (
                            <div
                              key={`${hex}-${i}`}
                              className="aspect-square rounded-md border-[0.5px] border-border"
                              style={{ backgroundColor: hex }}
                              title={hex}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
