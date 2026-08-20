import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2, CheckCircle2, Wand2, Bookmark, RotateCcw } from "lucide-react";
import { ClimateWidget, ClimateGlyph } from "@/components/dashboard/climate-widget";
import type { ClimateState } from "@/constants/climate";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import {
  generateDailyLook,
  regenerateOutfitImage,
  type DailyLook,
  type GeneratedLook,
} from "@/lib/generate-outfit.functions";
import { saveOutfitToHistory } from "@/lib/save-outfit.functions";
import { OutfitVisual } from "@/components/dashboard/outfit-visual";
import { OutfitResultSkeleton } from "@/components/dashboard/outfit-result-skeleton";
import { GeneratedLookDetail } from "@/components/dashboard/generated-look-detail";
import { toast } from "sonner";
import { UpgradeSlotsDialog } from "@/components/dashboard/upgrade-slots-dialog";
import { isInsufficientCreditsError } from "@/lib/credits";
import { profileQueryOptions } from "@/lib/queries/profile";
import { queryKeys } from "@/constants/query-keys";
import { isStyleProfileComplete, toStyleProfileRow } from "@/lib/style-profile/completion";
import { useConcierge } from "@/hooks/use-concierge";
import { DailyPaletteGenerator } from "@/components/dashboard/daily-palette-generator";
import { DossierCompletionBanner } from "@/components/dashboard/dossier-completion-banner";
import { takeFirstLookHandoff } from "@/lib/first-look";
import { errorMessage } from "@/lib/utils";

const VIBES = [
  "Everyday Casual",
  "Work or School",
  "Business Casual",
  "Business Attire",
  "Brunch",
  "Date Night",
  "Dinner",
  "Party",
  "Formal Event",
  "Travel",
  "Active Day",
] as const;

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

export const Route = createFileRoute("/_authenticated/_app/dashboard")({
  component: Dashboard,
});

type Vibe = (typeof VIBES)[number];

function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    ...profileQueryOptions(user?.id),
    enabled: !!user?.id,
  });

  const profileComplete = isStyleProfileComplete(toStyleProfileRow(profile));

  const { openConcierge } = useConcierge();
  const [generating, setGenerating] = useState(false);
  const [look, setLook] = useState<GeneratedLook | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [savingLook, setSavingLook] = useState(false);
  const [savedLook, setSavedLook] = useState<{ id: string; imageUrl: string } | null>(null);
  const lookSaved = !!savedLook;
  const [vibe, setVibe] = useState<Vibe>("Everyday Casual");
  const [creditPaywallOpen, setCreditPaywallOpen] = useState(false);
  const [climate, setClimate] = useState<ClimateState | null>(null);

  const generate = useServerFn(generateDailyLook);
  const regenerateImage = useServerFn(regenerateOutfitImage);
  const saveOutfit = useServerFn(saveOutfitToHistory);

  async function fetchImage(outfit: DailyLook) {
    setImageLoading(true);
    try {
      const res = await regenerateImage({ data: outfit });
      setLook((prev) => (prev ? { ...prev, imageGenerationError: undefined, ...res } : prev));
      setSavedLook(null);
      return res;
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
        setLook((prev) =>
          prev ? { ...prev, imageDataUri: null, imageGenerationError: undefined } : prev,
        );
        return { imageDataUri: null, imageGenerationError: undefined };
      }
      const message = errorMessage(e, "Your look is ready, but Mila couldn’t create the visual.");
      setLook((prev) =>
        prev ? { ...prev, imageDataUri: null, imageGenerationError: message } : prev,
      );
      return { imageDataUri: null, imageGenerationError: message };
    } finally {
      setImageLoading(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(user?.id) });
    }
  }

  async function generateLook() {
    if (generating || imageLoading) return;
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
      };

      outfit = await generate({ data: payload });
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(user?.id) });
    } catch (e) {
      setGenerating(false);
      if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
      } else {
        toast.error(errorMessage(e, "Couldn’t compose a look. Please try again."));
      }
      return;
    }
    setGenerating(false);
    setLook({ ...outfit, imageDataUri: null });
    await fetchImage(outfit);
  }

  async function retryImage() {
    if (!look || imageLoading || generating) return;
    const { outfit, hair, makeup, vibe_alignment_score } = look;
    const res = await fetchImage({ outfit, hair, makeup, vibe_alignment_score });
    if (res.imageDataUri) {
      toast.success("Visual ready.");
    } else if (res.imageGenerationError) {
      toast.error(res.imageGenerationError);
    }
  }

  async function saveLookToHistory() {
    if (!user || !look || !climate) return;
    if (!look.imageDataUri) {
      toast.error("Your look needs its visual before it can be saved.");
      return;
    }
    setSavingLook(true);
    try {
      const row = await saveOutfit({
        data: {
          imageDataUri: look.imageDataUri,
          weather: `${climate.label} (${climate.location})`,
          vibe,
          outfit: look.outfit,
          hair: look.hair,
          makeup: look.makeup,
          vibe_alignment_score: look.vibe_alignment_score,
        },
      });
      setSavedLook({ id: row.id, imageUrl: row.image_url });
      toast.success("Saved to your history.");
    } catch (e) {
      toast.error(errorMessage(e, "We couldn’t save that look. Please try again."));
    } finally {
      setSavingLook(false);
    }
  }

  // Arriving straight from onboarding: compose the first look as soon as the
  // weather lands, so the dashboard proves itself before it asks for anything.
  const [pendingFirstLook, setPendingFirstLook] = useState(false);
  useEffect(() => setPendingFirstLook(takeFirstLookHandoff()), []);
  useEffect(() => {
    if (!pendingFirstLook || !climate || !profileComplete || generating || look) return;
    setPendingFirstLook(false);
    void generateLook();
    // generateLook is recreated every render; the flag above is the real guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFirstLook, climate, profileComplete, generating, look]);

  const blockedReason = !profileComplete
    ? "Complete your Style Profile first."
    : !climate
      ? "Still finding today’s weather. Choose a city in the weather panel to continue."
      : null;

  const saveBlockedReason =
    look && !look.imageDataUri && !savingLook && !lookSaved
      ? "Your look needs its visual before it can be saved."
      : null;

  return (
    <div className="atelier-page max-w-5xl">
      <section>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1
              suppressHydrationWarning
              className="atelier-title text-3xl font-bold md:text-4xl text-balance wrap-break-word"
            >
              {getGreeting()}
              {greetingSuffix(profile?.full_name)}.
            </h1>
            <p className="text-base text-muted-foreground mt-2 max-w-md text-pretty">
              Let Mila compose an ideal OOTD for today’s weather, your palette, and your silhouette.
            </p>
          </div>
          <ClimateWidget value={climate} onChange={setClimate} />
        </div>

        <div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
          <div className="w-full sm:max-w-xs">
            <span id="vibe-label" className="atelier-section-label mb-2 block">
              Today’s mood
            </span>
            <Select value={vibe} onValueChange={(v) => setVibe(v as Vibe)}>
              <SelectTrigger
                aria-labelledby="vibe-label"
                className="rounded-full border-border bg-card"
              >
                <SelectValue placeholder="Select an occasion" />
              </SelectTrigger>
              <SelectContent>
                {VIBES.map((v) => (
                  <SelectItem key={v} value={v} className="text-sm">
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={generateLook}
            disabled={generating || !profileComplete || !climate || imageLoading}
            aria-describedby={blockedReason ? "generate-blocked" : undefined}
            size="pill"
            className="w-full sm:w-auto"
          >
            {generating ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" /> Composing…
              </>
            ) : (
              <>
                <Wand2 aria-hidden="true" /> Create my look
              </>
            )}
          </Button>
        </div>
        {blockedReason && (
          <p id="generate-blocked" className="mt-3 text-sm text-muted-foreground text-pretty">
            {blockedReason}
          </p>
        )}
      </section>

      <div className="mt-8 sm:mt-10">
        {generating ? (
          <OutfitResultSkeleton />
        ) : look ? (
          <section aria-labelledby="todays-look" className="space-y-6">
            <p role="status" aria-live="polite" className="sr-only">
              Your look is ready: {look.outfit.headline}
            </p>

            <div className="space-y-1.5">
              <h2 id="todays-look" className="atelier-headline">
                Today’s look
              </h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>{vibe}</span>
                {climate && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <ClimateGlyph icon={climate.icon} className="size-3.5" />
                      {climate.label}
                    </span>
                  </>
                )}
              </div>
            </div>

            <GeneratedLookDetail
              outfit={look.outfit}
              hair={look.hair}
              makeup={look.makeup}
              media={
                <OutfitVisual
                  imageDataUri={look.imageDataUri}
                  imageGenerationError={look.imageGenerationError}
                  loading={imageLoading}
                  headline={look.outfit.headline}
                  onRetry={retryImage}
                  retryDisabled={imageLoading || generating}
                />
              }
            />

            <div className="border-t border-border pt-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  onClick={saveLookToHistory}
                  disabled={savingLook || lookSaved || !look.imageDataUri}
                  aria-describedby={saveBlockedReason ? "save-blocked" : undefined}
                  size="pill"
                >
                  {lookSaved ? (
                    <>
                      <CheckCircle2 aria-hidden="true" /> Saved
                    </>
                  ) : savingLook ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" /> Saving…
                    </>
                  ) : (
                    <>
                      <Bookmark aria-hidden="true" /> Save to history
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={retryImage}
                  disabled={imageLoading || generating}
                  size="pill"
                >
                  {imageLoading ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" /> Drawing…
                    </>
                  ) : (
                    <>
                      <RotateCcw aria-hidden="true" /> New visual
                    </>
                  )}
                </Button>
                <Button variant="ghost" onClick={generateLook} disabled={imageLoading} size="pill">
                  <Sparkles aria-hidden="true" /> Try another look
                </Button>
                {savedLook && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      openConcierge({
                        lookId: savedLook.id,
                        imageUrl: savedLook.imageUrl,
                        title: look.outfit.headline,
                        source: "Today’s look",
                      })
                    }
                    size="pill"
                  >
                    <Sparkles aria-hidden="true" /> Ask Mila about this look
                  </Button>
                )}
              </div>
              {saveBlockedReason && (
                <p id="save-blocked" className="mt-3 text-sm text-muted-foreground">
                  {saveBlockedReason}
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Each new look or visual uses one credit.
              </p>
            </div>
          </section>
        ) : (
          <section className="rounded-card border border-border bg-card px-6 py-12 text-center">
            <h2 className="font-serif text-2xl font-semibold tracking-tight leading-snug text-balance">
              Set the mood. Mila will compose the rest.
            </h2>
            <p className="text-base text-muted-foreground mt-2 max-w-md mx-auto text-pretty">
              Each look is composed from first principles — tuned to your palette, body
              architecture, and the weather outside.
            </p>
          </section>
        )}
      </div>

      {/* The nudge comes after the dashboard has proved itself, not before. */}
      <DossierCompletionBanner profile={profile} className="mt-10 sm:mt-12" />

      {/* A different daily artifact: a rule and a wider gap make the break. */}
      {profile?.color_season && (
        <div className="mt-14 border-t border-border/70 pt-10 sm:mt-16 sm:pt-12">
          <DailyPaletteGenerator userColorSeason={profile.color_season} />
        </div>
      )}

      <UpgradeSlotsDialog open={creditPaywallOpen} onOpenChange={setCreditPaywallOpen} />
    </div>
  );
}
