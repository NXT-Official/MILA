import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClimateWidget } from "@/components/dashboard/climate-widget";
import type { ClimateState } from "@/constants/climate";
import { useAuth } from "@/hooks/use-auth";
import { generateDailyLook, type DailyLook } from "@/lib/generate-outfit.functions";
import { saveOutfitToHistory } from "@/lib/save-outfit.functions";
import { HeroGeneratorForm, type Vibe } from "@/components/dashboard/hero-generator-form";
import { HeroResultPanel } from "@/components/dashboard/hero-result-panel";
import { generatePhotoPreview } from "@/lib/photo-preview.functions";
import { generateStyleSheetPreview } from "@/lib/style-sheet.functions";
import { SelfiePhotoWidget } from "@/components/dashboard/selfie-photo-widget";
import { toast } from "sonner";
import { UpgradeSlotsDialog } from "@/components/dashboard/upgrade-slots-dialog";
import { isInsufficientCreditsError } from "@/lib/credits";
import { profileQueryOptions } from "@/lib/queries/profile";
import { queryKeys } from "@/constants/query-keys";
import { isStyleProfileComplete, toStyleProfileRow } from "@/lib/style-profile/completion";
import { useConcierge } from "@/hooks/use-concierge";
import { useCurrentLook } from "@/hooks/use-current-look";
import { DailyPaletteGenerator } from "@/components/wardrobe/DailyPaletteGenerator";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { errorMessage, isStaleBundleError, TimeoutError, withTimeout } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/track-event";
import { notifyIfBackgrounded, requestNotificationPermission } from "@/lib/background-notify";
import {
  Coins,
  Sparkles,
  Flame,
  Images,
  MessageCircle,
  History as HistoryIcon,
} from "lucide-react";
import { creditsQueryOptions } from "@/lib/queries/credits";
import {
  dashboardLookStatsQueryOptions,
  styleProfileCompletionPercent,
} from "@/lib/queries/dashboard-stats";
import { StatTile } from "@/components/dashboard/stat-tile";
import { RecentLooksStrip } from "@/components/dashboard/recent-looks-strip";

function reloadForNewVersion() {
  toast.error("Mila just updated — reloading to grab the latest version. Try again after reload.");
  window.location.reload();
}

// A stuck generation call has no legitimate reason to run past this — the
// server side's own retry budget tops out well under these ceilings (see
// FUNCTION_BUDGET_MS in style-sheet.ts, 280s). Generation itself now runs
// TWO sequential deepseek calls (inventory review, then outfit plan), each
// bounded at 75s server-side, so this must clear 150s worst case. Set
// generously above that so a real in-progress generation is never cut off
// before the server's own graceful deadline can return its own
// "unavailable" message — only a genuinely hung request should ever hit
// this client-side timeout.
const LOOK_TIMEOUT_MS = 170_000;
const VISUAL_TIMEOUT_MS = 290_000;

const TIMEOUT_MESSAGE = "This is taking longer than expected. Please refresh and try again.";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function greetingSuffix(fullName: string | null | undefined) {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `, ${first}` : "";
}

const containerVariants = (reduce: boolean, stagger: number): Variants => ({
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: reduce ? 0 : stagger } },
});
const itemVariants = (reduce: boolean, offset: number, duration: number): Variants => ({
  hidden: { opacity: 0, y: reduce ? 0 : offset },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: reduce ? 0.2 : duration, ease: "easeOut" as const },
  },
});

export const Route = createFileRoute("/_authenticated/_app/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion() ?? false;
  const cardContainerVariants = containerVariants(reduce, 0.08);
  const cardItemVariants = itemVariants(reduce, 12, 0.35);
  const resultContainerVariants = containerVariants(reduce, 0.1);
  const resultItemVariants = itemVariants(reduce, 16, 0.4);

  const { data: profile, isLoading: profileLoading } = useQuery({
    ...profileQueryOptions(user?.id),
    enabled: !!user?.id,
  });

  const profileComplete = isStyleProfileComplete(toStyleProfileRow(profile));
  const profileCompletionPercent = styleProfileCompletionPercent(toStyleProfileRow(profile));

  const {
    data: credits,
    isLoading: creditsLoading,
    isError: creditsError,
  } = useQuery(creditsQueryOptions(user?.id));
  const {
    data: lookStats,
    isLoading: lookStatsLoading,
    isError: lookStatsError,
  } = useQuery(dashboardLookStatsQueryOptions(user?.id));

  const { openConcierge } = useConcierge();
  const {
    look,
    setLook,
    styleSheetImageDataUri,
    setStyleSheetImageDataUri,
    savedLook,
    setSavedLook,
  } = useCurrentLook();
  const [generating, setGenerating] = useState(false);
  const [savingLook, setSavingLook] = useState(false);
  const lookSaved = !!savedLook;
  const [vibe, setVibe] = useState<Vibe>("Everyday Casual");
  const [agenda, setAgenda] = useState("");
  const [dressCode, setDressCode] = useState("");
  const [indoorOutdoor, setIndoorOutdoor] = useState<"Indoor" | "Outdoor" | "Mixed" | "">("");
  const [creditPaywallOpen, setCreditPaywallOpen] = useState(false);
  const [climate, setClimate] = useState<ClimateState | null>(null);
  const [photoPreviewLoading, setPhotoPreviewLoading] = useState(false);
  const [styleSheetLoading, setStyleSheetLoading] = useState(false);

  const generate = useServerFn(generateDailyLook);
  const saveOutfit = useServerFn(saveOutfitToHistory);
  const generatePhotoPreviewFn = useServerFn(generatePhotoPreview);
  const generateStyleSheetFn = useServerFn(generateStyleSheetPreview);

  /** Shared by the auto-generation in generateLook() and the manual retry button. */
  async function generateStyleSheetVisual(outfitForSheet: {
    outfit: DailyLook["outfit"];
    hair: DailyLook["hair"];
    makeup: DailyLook["makeup"];
    vibe_alignment_score: DailyLook["vibe_alignment_score"];
    shoppable_picks: DailyLook["shoppable_picks"];
    forecastRetrievedAt: DailyLook["forecastRetrievedAt"];
  }) {
    setStyleSheetLoading(true);
    requestNotificationPermission();
    try {
      const res = await withTimeout(
        generateStyleSheetFn({ data: { outfit: outfitForSheet } }),
        VISUAL_TIMEOUT_MS,
      );
      if (res.mode === "style_sheet") {
        setStyleSheetImageDataUri(res.imageDataUri);
        setSavedLook(null);
        // The user may have tabbed away during the render — a toast alone
        // (shown by the callers below) would go unseen. This covers the
        // background case; the foregrounded case keeps its existing toast.
        notifyIfBackgrounded("Your look is ready", "Mila finished rendering your style sheet.");
        return true;
      }
      toast.error(res.reason);
      return false;
    } catch (e) {
      if (e instanceof TimeoutError) {
        toast.error(TIMEOUT_MESSAGE);
      } else if (isStaleBundleError(e)) {
        reloadForNewVersion();
      } else if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
      } else {
        toast.error(errorMessage(e, "Couldn't create your style sheet. Please try again."));
      }
      return false;
    } finally {
      setStyleSheetLoading(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(user?.id) });
    }
  }

  async function generateLook() {
    if (generating) return;
    if (!user || !profile?.body_type || !profile?.color_season) {
      toast.error("Complete your Style Profile first.");
      return;
    }
    if (!climate) {
      toast.error("Still finding today’s weather. Choose a city in the weather panel to continue.");
      return;
    }
    setGenerating(true);
    setLook(null);
    setSavedLook(null);
    setStyleSheetImageDataUri(null);
    let outfit: DailyLook;
    try {
      const payload = {
        bodyType: profile.body_type,
        colorSeason: profile.color_season,
        skinUndertone: profile.skin_undertone ?? null,
        faceShape: profile.face_shape ?? null,
        hairType: profile.hair_type ?? null,
        weather: `${climate.label} (in ${climate.location})`,
        tempF: climate.tempF,
        tempC: climate.tempC,
        condition: climate.condition,
        location: climate.location,
        vibe,
        agenda: agenda.trim() || undefined,
        dressCode: dressCode.trim() || undefined,
        indoorOutdoor: indoorOutdoor || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      outfit = await withTimeout(generate({ data: payload }), LOOK_TIMEOUT_MS);
      trackEvent(supabase, user.id, "look_generated", { vibe });
    } catch (e) {
      setGenerating(false);
      // The server refunds the credit on any thrown error (see
      // withAiCredit), but this path never re-fetched the credits query —
      // so the header kept showing the pre-refund count, reading as a
      // charge for a failed generation. Match the other handlers below,
      // which all refresh credits after every attempt, success or not.
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(user?.id) });
      if (e instanceof TimeoutError) {
        toast.error(TIMEOUT_MESSAGE);
      } else if (isStaleBundleError(e)) {
        reloadForNewVersion();
      } else if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
      } else {
        toast.error(errorMessage(e, "Couldn’t compose a look. Please try again."));
      }
      return;
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.credits(user?.id) });
    setGenerating(false);
    setLook({ ...outfit, imageDataUri: null });

    // No stock-model fallback anymore — a visual requires a consented
    // photo, since the style sheet is now the only auto-generated image.
    if (!profile.photo_consent_at) return;

    const {
      outfit: outfitBody,
      hair,
      makeup,
      vibe_alignment_score,
      shoppable_picks,
      forecastRetrievedAt,
    } = outfit;
    await generateStyleSheetVisual({
      outfit: outfitBody,
      hair,
      makeup,
      vibe_alignment_score,
      shoppable_picks,
      forecastRetrievedAt,
    });
  }

  async function previewOnMyPhoto() {
    if (!look || photoPreviewLoading || generating) return;
    setPhotoPreviewLoading(true);
    requestNotificationPermission();
    try {
      const { outfit, hair, makeup, vibe_alignment_score } = look;
      const res = await withTimeout(
        generatePhotoPreviewFn({
          data: { outfit: { outfit, hair, makeup, vibe_alignment_score } },
        }),
        VISUAL_TIMEOUT_MS,
      );
      if (res.mode === "photo_edit") {
        setLook((prev) => (prev ? { ...prev, imageDataUri: res.imageDataUri } : prev));
        setSavedLook(null);
        toast.success("Portrait preview ready.");
        notifyIfBackgrounded(
          "Your portrait preview is ready",
          "Mila finished rendering your photo preview.",
        );
      } else {
        toast.error(res.reason);
      }
    } catch (e) {
      if (e instanceof TimeoutError) {
        toast.error(TIMEOUT_MESSAGE);
      } else if (isStaleBundleError(e)) {
        reloadForNewVersion();
      } else if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
      } else {
        toast.error(errorMessage(e, "Couldn't create a photo preview. Please try again."));
      }
    } finally {
      setPhotoPreviewLoading(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(user?.id) });
    }
  }

  async function previewStyleSheet() {
    if (!look || styleSheetLoading || generating) return;
    const { outfit, hair, makeup, vibe_alignment_score, shoppable_picks, forecastRetrievedAt } =
      look;
    const ok = await generateStyleSheetVisual({
      outfit,
      hair,
      makeup,
      vibe_alignment_score,
      shoppable_picks,
      forecastRetrievedAt,
    });
    if (ok) toast.success("Style sheet ready.");
  }

  async function saveLookToHistory() {
    if (!user || !look || !climate) return;
    // The style sheet — when the auto-generation on "Create my look"
    // produced one — is the richer artifact, so it's what gets saved.
    const imageToSave = styleSheetImageDataUri ?? look.imageDataUri;
    if (!imageToSave) {
      toast.error("Your look needs its visual before it can be saved.");
      return;
    }
    setSavingLook(true);
    try {
      const row = await saveOutfit({
        data: {
          imageDataUri: imageToSave,
          weather: `${climate.label} (${climate.location})`,
          vibe,
          outfit: look.outfit,
          hair: look.hair,
          makeup: look.makeup,
          vibe_alignment_score: look.vibe_alignment_score,
          forecastRetrievedAt: look.forecastRetrievedAt ?? null,
          productIds: (look.shoppable_picks ?? []).map((item) => item.id),
          previewMode: styleSheetImageDataUri ? "style_sheet" : "photo_edit",
        },
      });
      setSavedLook({ id: row.id, imageUrl: row.image_url });
      toast.success("Saved to your history.");
    } catch (e) {
      if (isStaleBundleError(e)) {
        reloadForNewVersion();
      } else {
        toast.error(errorMessage(e, "We couldn’t save that look. Please try again."));
      }
    } finally {
      setSavingLook(false);
    }
  }

  const blockedReason = profileLoading
    ? "Loading your Style Profile…"
    : !profileComplete
      ? "Complete your Style Profile first."
      : !climate
        ? "Still finding today’s weather. Choose a city in the weather panel to continue."
        : null;

  function handleAskConcierge() {
    if (!savedLook || !look) return;
    openConcierge({
      lookId: savedLook.id,
      imageUrl: savedLook.imageUrl,
      title: look.outfit.headline,
      source: "Today's look",
    });
  }

  return (
    <motion.div
      className="atelier-page"
      variants={cardContainerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.section
        variants={cardItemVariants}
        className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <StatTile
          label="AI Credits"
          value={String(credits ?? 0)}
          icon={Coins}
          loading={creditsLoading}
          error={creditsError}
        />
        <StatTile
          label="Style Profile"
          value={`${profileCompletionPercent}%`}
          icon={Sparkles}
          loading={profileLoading}
        />
        <StatTile
          label="Looks this month"
          value={String(lookStats?.looksThisMonth ?? 0)}
          icon={Images}
          loading={lookStatsLoading}
          error={lookStatsError}
        />
        <StatTile
          label="Day streak"
          value={String(lookStats?.streakDays ?? 0)}
          icon={Flame}
          loading={lookStatsLoading}
          error={lookStatsError}
        />
      </motion.section>

      <Card asChild className="relative mb-10 sm:mb-14 overflow-hidden atelier-hero-card">
        <motion.section variants={cardItemVariants}>
          <div className="pointer-events-none absolute -top-32 -right-20 h-80 w-80 rounded-full bg-accent/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-rose/15 blur-3xl" />

          <div className="relative p-6 sm:p-8 md:p-10">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h1
                  suppressHydrationWarning
                  className="atelier-title text-4xl leading-none md:text-5xl text-balance wrap-break-word"
                >
                  {getGreeting()}
                  {greetingSuffix(profile?.full_name)}.
                </h1>
                <p className="text-base text-muted-foreground mt-2 max-w-md text-pretty">
                  Let Mila compose an ideal OOTD for today's weather, your palette, and your
                  silhouette.
                </p>
                {profile?.gender ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Styling for {profile.gender}
                    {profile.gender !== "Male"
                      ? ` · Makeup: ${profile.makeup_preference && profile.makeup_preference !== "none" ? profile.makeup_preference : "off"}`
                      : ""}
                    {" · "}
                    <Link to="/style-profile" className="underline hover:text-foreground">
                      Change
                    </Link>
                  </p>
                ) : null}
                <div className="mt-3">
                  <SelfiePhotoWidget hasConsent={!!profile?.photo_consent_at} userId={user?.id} />
                </div>
              </div>
              <ClimateWidget value={climate} onChange={setClimate} />
            </div>

            <HeroGeneratorForm
              vibe={vibe}
              onVibeChange={setVibe}
              agenda={agenda}
              onAgendaChange={setAgenda}
              dressCode={dressCode}
              onDressCodeChange={setDressCode}
              indoorOutdoor={indoorOutdoor}
              onIndoorOutdoorChange={setIndoorOutdoor}
              climate={climate}
              generating={generating}
              profileComplete={profileComplete}
              blockedReason={blockedReason}
              onGenerate={generateLook}
            />

            <div className="mt-8">
              <HeroResultPanel
                generating={generating}
                look={look}
                vibe={vibe}
                climate={climate}
                profile={profile}
                styleSheetLoading={styleSheetLoading}
                styleSheetImageDataUri={styleSheetImageDataUri}
                photoPreviewLoading={photoPreviewLoading}
                savingLook={savingLook}
                lookSaved={lookSaved}
                savedLook={savedLook}
                resultContainerVariants={resultContainerVariants}
                resultItemVariants={resultItemVariants}
                onPreviewStyleSheet={previewStyleSheet}
                onPreviewOnMyPhoto={previewOnMyPhoto}
                onSaveLook={saveLookToHistory}
                onGenerateAnother={generateLook}
                onAskConcierge={handleAskConcierge}
              />
            </div>
          </div>
        </motion.section>
      </Card>

      <motion.section
        variants={cardItemVariants}
        className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr] mt-10"
      >
        <RecentLooksStrip looks={lookStats?.recentLooks} loading={lookStatsLoading} />

        {profile?.color_season && <DailyPaletteGenerator userColorSeason={profile.color_season} />}
      </motion.section>

      <motion.section
        variants={cardItemVariants}
        className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <button
          type="button"
          onClick={() => openConcierge()}
          className="atelier-focus-ring flex flex-col items-center gap-2 rounded-card border border-porcelain/40 bg-card p-4 text-center transition-colors hover:bg-accent-soft/40"
        >
          <MessageCircle className="size-5 text-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs text-ink">Concierge</span>
        </button>
        <Link
          to="/style-profile"
          className="atelier-focus-ring flex flex-col items-center gap-2 rounded-card border border-porcelain/40 bg-card p-4 text-center transition-colors hover:bg-accent-soft/40"
        >
          <Sparkles className="size-5 text-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs text-ink">Style Profile</span>
        </Link>
        <Link
          to="/feed"
          className="atelier-focus-ring flex flex-col items-center gap-2 rounded-card border border-porcelain/40 bg-card p-4 text-center transition-colors hover:bg-accent-soft/40"
        >
          <Images className="size-5 text-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs text-ink">Feed</span>
        </Link>
        <Link
          to="/history"
          className="atelier-focus-ring flex flex-col items-center gap-2 rounded-card border border-porcelain/40 bg-card p-4 text-center transition-colors hover:bg-accent-soft/40"
        >
          <HistoryIcon className="size-5 text-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs text-ink">History</span>
        </Link>
      </motion.section>

      <UpgradeSlotsDialog open={creditPaywallOpen} onOpenChange={setCreditPaywallOpen} />
    </motion.div>
  );
}
