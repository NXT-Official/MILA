import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { isStyleProfileComplete } from "@/lib/style-profile/completion";
import { useConcierge } from "@/hooks/use-concierge";
import { DailyPaletteGenerator } from "@/components/wardrobe/DailyPaletteGenerator";
import { motion, type Variants } from "framer-motion";

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

const cardContainerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const cardItemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" as const } },
};
const resultContainerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};
const resultItemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

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

  const profileComplete = isStyleProfileComplete(
    profile
      ? {
          skin_undertone: profile.skin_undertone,
          color_season: profile.color_season_base,
          body_type: profile.body_type,
          face_shape: profile.face_shape,
          hair_type: profile.hair_type,
          color_profile: profile.color_profile,
        }
      : null,
  );

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

  /** Cloudflare-only step, shared by the initial post-text fetch and Retry visual. */
  async function fetchImage(outfit: DailyLook) {
    setImageLoading(true);
    try {
      const res = await regenerateImage({ data: outfit });
      setLook((prev) => (prev ? { ...prev, ...res } : prev));
      return res;
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "The outfit is ready, but the visual could not be generated.";
      setLook((prev) =>
        prev ? { ...prev, imageDataUri: null, imageGenerationError: message } : prev,
      );
      return { imageDataUri: null, imageGenerationError: message };
    } finally {
      setImageLoading(false);
    }
  }

  async function generateLook() {
    if (!user || !profile?.body_type || !profile?.color_season) {
      toast.error("Complete your Style Profile first.");
      return;
    }
    if (!climate) {
      toast.error("Still detecting your local weather — try again in a moment.");
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
        // beautyPreferences is intentionally omitted — the server loads it
        // itself from the authenticated user's profile.
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
        toast.error(e instanceof Error ? e.message : "Couldn't generate a look.");
      }
      return;
    }
    // The written outfit is ready — show it immediately rather than making
    // the user wait on the (separate) Cloudflare visual too.
    setGenerating(false);
    setLook({ ...outfit, imageDataUri: null });
    await fetchImage(outfit);
  }

  async function retryImage() {
    if (!look) return;
    const { outfit, hair, makeup, vibe_alignment_score } = look;
    const res = await fetchImage({ outfit, hair, makeup, vibe_alignment_score });
    if (res.imageDataUri) {
      toast.success("Visual updated.");
    } else if (res.imageGenerationError) {
      toast.error(res.imageGenerationError);
    }
  }

  async function saveLookToHistory() {
    if (!user || !look || !climate) return;
    if (!look.imageDataUri) {
      toast.error("Wait for the visual to finish generating before saving.");
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
      toast.error(
        e instanceof Error ? e.message : "The look could not be saved. Please try again.",
      );
    } finally {
      setSavingLook(false);
    }
  }

  return (
    <motion.div
      className="atelier-page max-w-5xl"
      variants={cardContainerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.section
        variants={cardItemVariants}
        className="relative mb-10 sm:mb-14 overflow-hidden atelier-card atelier-hero-card"
      >
        <div className="pointer-events-none absolute -top-32 -right-20 h-80 w-80 rounded-full bg-atelier-champagne/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-atelier-rose/15 blur-3xl" />

        <div className="relative p-6 sm:p-8 md:p-10">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="atelier-kicker">Today</p>
              <h2 className="atelier-title mt-2">
                {getGreeting()}
                {profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}.
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-md">
                Let Mila compose an ideal OOTD for today's weather, your palette, and your
                silhouette.
              </p>
            </div>
            <ClimateWidget value={climate} onChange={setClimate} />
          </div>

          <div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
            <div className="w-full sm:max-w-xs">
              <p className="atelier-kicker mb-2">Today's Mood</p>
              <Select value={vibe} onValueChange={(v) => setVibe(v as Vibe)}>
                <SelectTrigger className="h-11 rounded-full border-border bg-card/60 backdrop-blur uppercase tracking-[0.18em] text-[11px]">
                  <SelectValue placeholder="Select an occasion" />
                </SelectTrigger>
                <SelectContent>
                  {VIBES.map((v) => (
                    <SelectItem
                      key={v}
                      value={v}
                      className="uppercase tracking-[0.18em] text-[11px]"
                    >
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={generateLook}
              disabled={generating || !profileComplete || !climate || imageLoading}
              className="w-full sm:w-auto h-12 px-6 rounded-full bg-foreground text-background hover:bg-foreground/90 uppercase tracking-[0.2em] text-xs whitespace-normal text-center leading-snug"
            >
              {generating ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" /> Composing…
                </>
              ) : climate ? (
                <>
                  <Wand2 className="size-4 mr-2 shrink-0 text-accent" /> Create my look —{" "}
                  {climate.tempC}°C{" "}
                  {climate.label.replace(/^[-\d.]+\s*°[CF]\s*/i, "").split(/[\s,]+/)[0] ||
                    climate.condition}
                </>
              ) : (
                <>
                  <Wand2 className="size-4 mr-2 shrink-0 text-accent" /> Create my look
                </>
              )}
            </Button>
            {!profileComplete && (
              <span className="text-xs text-muted-foreground">
                Complete your style profile to unlock.
              </span>
            )}
          </div>

          <div className="mt-8">
            {generating ? (
              <OutfitResultSkeleton />
            ) : look ? (
              <motion.div
                className="space-y-6"
                variants={resultContainerVariants}
                initial="hidden"
                animate="visible"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 backdrop-blur px-3 py-1 text-[10px] uppercase tracking-[0.22em]">
                    <span className="text-muted-foreground">{vibe}</span>
                    <span className="h-1 w-1 rounded-full bg-foreground/40" />
                    <span className="font-medium">Vibe fit {look.vibe_alignment_score}/10</span>
                    {climate && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-foreground/40" />
                        <ClimateGlyph icon={climate.icon} className="size-3" />
                        <span className="text-muted-foreground">{climate.label}</span>
                      </>
                    )}
                  </span>
                </div>

                <motion.div variants={resultItemVariants}>
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
                </motion.div>

                <motion.div
                  variants={resultItemVariants}
                  className="flex flex-wrap items-center gap-3 border-t border-border pt-5"
                >
                  <Button
                    variant="outline"
                    onClick={saveLookToHistory}
                    disabled={savingLook || lookSaved || !look.imageDataUri}
                    className="rounded-full h-10 px-5 uppercase tracking-[0.2em] text-[11px]"
                  >
                    {lookSaved ? (
                      <>
                        <CheckCircle2 className="size-4 mr-2" /> Saved
                      </>
                    ) : savingLook ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" /> Saving
                      </>
                    ) : (
                      <>
                        <Bookmark className="size-4 mr-2" /> Save to history
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={retryImage}
                    disabled={imageLoading || generating}
                    className="rounded-full h-10 px-5 uppercase tracking-[0.2em] text-[11px]"
                  >
                    {imageLoading ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" /> Retrying
                      </>
                    ) : (
                      <>
                        <RotateCcw className="size-4 mr-2" /> Retry visual
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={generateLook}
                    disabled={imageLoading}
                    className="rounded-full h-10 px-5 uppercase tracking-[0.2em] text-[11px]"
                  >
                    <Sparkles className="size-4 mr-2 text-accent" /> Try another
                  </Button>
                  {savedLook && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        openConcierge({
                          lookId: savedLook.id,
                          imageUrl: savedLook.imageUrl,
                          title: look.outfit.headline,
                          source: "Today's look",
                        })
                      }
                      className="rounded-full h-10 px-5 uppercase tracking-[0.2em] text-[11px]"
                    >
                      <Sparkles className="size-4 mr-2 text-accent" /> Ask Mila about this look
                    </Button>
                  )}
                </motion.div>
              </motion.div>
            ) : (
              <div className="rounded-2xl border border-border bg-card p-10 text-center">
                <p className="atelier-kicker">ready when you are</p>
                <p className="atelier-title mt-2">Set the mood. Mila will compose the rest.</p>
                <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                  Each look is composed from first principles — tuned to your palette, body
                  architecture, and the weather outside.
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.section>

      {profile?.color_season && (
        <motion.section variants={cardItemVariants}>
          <DailyPaletteGenerator userColorSeason={profile.color_season} />
        </motion.section>
      )}

      <UpgradeSlotsDialog open={creditPaywallOpen} onOpenChange={setCreditPaywallOpen} user={user} />
    </motion.div>
  );
}
