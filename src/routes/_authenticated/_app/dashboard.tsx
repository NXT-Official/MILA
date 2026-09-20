import { createFileRoute, Link } from "@tanstack/react-router";
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
import { ShopThisLookGrid } from "@/components/dashboard/shop-look-grid";
import { findLookProducts, type LookProduct } from "@/lib/look-products.functions";
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
import { DailyPaletteGenerator } from "@/components/wardrobe/DailyPaletteGenerator";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { errorMessage } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

type Vibe = (typeof VIBES)[number];

function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion() ?? false;
  const cardContainerVariants = containerVariants(reduce, 0.08);
  const cardItemVariants = itemVariants(reduce, 12, 0.35);
  const resultContainerVariants = containerVariants(reduce, 0.1);
  const resultItemVariants = itemVariants(reduce, 16, 0.4);

  const { data: profile } = useQuery({
    ...profileQueryOptions(user?.id),
    enabled: !!user?.id,
  });

  const profileComplete = isStyleProfileComplete(toStyleProfileRow(profile));

  const { openConcierge } = useConcierge();
  const [generating, setGenerating] = useState(false);
  const [look, setLook] = useState<GeneratedLook | null>(null);
  const [shopItems, setShopItems] = useState<LookProduct[] | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [savingLook, setSavingLook] = useState(false);
  const [savedLook, setSavedLook] = useState<{ id: string; imageUrl: string } | null>(null);
  const lookSaved = !!savedLook;
  const [vibe, setVibe] = useState<Vibe>("Everyday Casual");
  const [agenda, setAgenda] = useState("");
  const [dressCode, setDressCode] = useState("");
  const [indoorOutdoor, setIndoorOutdoor] = useState<"Indoor" | "Outdoor" | "Mixed" | "">("");
  const [creditPaywallOpen, setCreditPaywallOpen] = useState(false);
  const [climate, setClimate] = useState<ClimateState | null>(null);
  const [previewMode, setPreviewMode] = useState<"inspiration" | "photo_edit">("inspiration");
  const [photoPreviewLoading, setPhotoPreviewLoading] = useState(false);
  const [inspirationImageDataUri, setInspirationImageDataUri] = useState<string | null>(null);
  const [styleSheetLoading, setStyleSheetLoading] = useState(false);
  const [styleSheetImageDataUri, setStyleSheetImageDataUri] = useState<string | null>(null);

  const generate = useServerFn(generateDailyLook);
  const regenerateImage = useServerFn(regenerateOutfitImage);
  const saveOutfit = useServerFn(saveOutfitToHistory);
  const fetchLookProducts = useServerFn(findLookProducts);
  const generatePhotoPreviewFn = useServerFn(generatePhotoPreview);
  const generateStyleSheetFn = useServerFn(generateStyleSheetPreview);

  async function fetchShopItems(
    colorSeason: string,
    bodyType: string,
    tempF: number | undefined,
    region: string | undefined,
  ): Promise<LookProduct[] | null> {
    try {
      const items = await fetchLookProducts({
        data: { colorSeason, bodyType, tempF, region: region || undefined },
      });
      setShopItems(items);
      return items;
    } catch (e) {
      console.error("[dashboard] findLookProducts failed", e);
      setShopItems(null);
      return null;
    }
  }

  async function fetchImage(outfit: DailyLook) {
    setImageLoading(true);
    try {
      const res = await regenerateImage({ data: outfit });
      setLook((prev) => (prev ? { ...prev, imageGenerationError: undefined, ...res } : prev));
      setSavedLook(null);
      setPreviewMode("inspiration");
      if (res.imageDataUri) setInspirationImageDataUri(res.imageDataUri);
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
    setShopItems(null);
    setSavedLook(null);
    setPreviewMode("inspiration");
    setInspirationImageDataUri(null);
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

    const hasConsentedPhoto = !!profile.photo_consent_at;
    if (!hasConsentedPhoto) {
      void fetchShopItems(
        profile.color_season,
        profile.body_type,
        climate.tempF,
        profile.delivery_country || climate.country,
      );
      await fetchImage(outfit);
      return;
    }

    // Consented users get the face-on-photo version by default.
    void fetchShopItems(
      profile.color_season,
      profile.body_type,
      climate.tempF,
      profile.delivery_country || climate.country,
    );
    await fetchImage(outfit);

    setPhotoPreviewLoading(true);
    try {
      const { outfit: outfitBody, hair, makeup, vibe_alignment_score } = outfit;
      const res = await runPhotoPreview({ outfit: outfitBody, hair, makeup, vibe_alignment_score });
      if (res.mode === "photo_edit") {
        setLook((prev) => (prev ? { ...prev, imageDataUri: res.imageDataUri } : prev));
        setPreviewMode("photo_edit");
      } else {
        // Inspiration image (already generated above) stays as the shown
        // result — never a hard failure, since it's already a usable look.
        toast.info(res.reason);
      }
    } catch (e) {
      if (!isInsufficientCreditsError(e)) {
        console.error("[dashboard] automatic photo preview failed", e);
      }
      // Silent fallback to the inspiration image — the user didn't click
      // anything for this attempt, so don't interrupt with a paywall here.
    } finally {
      setPhotoPreviewLoading(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(user?.id) });
    }

    // Style sheet rides along with the same "Create my look" click for
    // consented users, rather than requiring a second manual "Generate style
    // sheet" click — the manual button still works afterward, for a retry.
    setStyleSheetLoading(true);
    try {
      const { outfit: outfitBody, hair, makeup, vibe_alignment_score, shoppable_picks, forecastRetrievedAt } =
        outfit;
      const res = await generateStyleSheetFn({
        data: {
          outfit: {
            outfit: outfitBody,
            hair,
            makeup,
            vibe_alignment_score,
            shoppable_picks,
            forecastRetrievedAt,
          },
        },
      });
      if (res.mode === "style_sheet") {
        setStyleSheetImageDataUri(res.imageDataUri);
      } else {
        // Same non-blocking fallback as the photo preview above — the
        // portrait visual is already a usable result on its own.
        toast.info(res.reason);
      }
    } catch (e) {
      if (!isInsufficientCreditsError(e)) {
        console.error("[dashboard] automatic style sheet failed", e);
      }
    } finally {
      setStyleSheetLoading(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(user?.id) });
    }
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

  /** Shared with the automatic post-generation attempt in generateLook(). */
  async function runPhotoPreview(outfitForEdit: {
    outfit: DailyLook["outfit"];
    hair: DailyLook["hair"];
    makeup: DailyLook["makeup"];
    vibe_alignment_score: DailyLook["vibe_alignment_score"];
  }) {
    return generatePhotoPreviewFn({ data: { outfit: outfitForEdit } });
  }

  async function previewOnMyPhoto() {
    if (!look || photoPreviewLoading || imageLoading || generating) return;
    setPhotoPreviewLoading(true);
    try {
      const { outfit, hair, makeup, vibe_alignment_score } = look;
      const res = await runPhotoPreview({ outfit, hair, makeup, vibe_alignment_score });
      if (res.mode === "photo_edit") {
        setLook((prev) => (prev ? { ...prev, imageDataUri: res.imageDataUri } : prev));
        setPreviewMode("photo_edit");
        setSavedLook(null);
        toast.success("Photo preview ready.");
      } else {
        toast.error(res.reason);
      }
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
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
    if (!look || styleSheetLoading || imageLoading || generating) return;
    setStyleSheetLoading(true);
    try {
      const { outfit, hair, makeup, vibe_alignment_score, shoppable_picks, forecastRetrievedAt } =
        look;
      const res = await generateStyleSheetFn({
        data: {
          outfit: {
            outfit,
            hair,
            makeup,
            vibe_alignment_score,
            shoppable_picks,
            forecastRetrievedAt,
          },
        },
      });
      if (res.mode === "style_sheet") {
        setStyleSheetImageDataUri(res.imageDataUri);
        toast.success("Style sheet ready.");
      } else {
        toast.error(res.reason);
      }
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
      } else {
        toast.error(errorMessage(e, "Couldn't create a style sheet. Please try again."));
      }
    } finally {
      setStyleSheetLoading(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(user?.id) });
    }
  }

  function backToInspirationImage() {
    if (!look) return;
    setSavedLook(null);
    if (inspirationImageDataUri) {
      setLook((prev) =>
        prev
          ? { ...prev, imageDataUri: inspirationImageDataUri, imageGenerationError: undefined }
          : prev,
      );
      setPreviewMode("inspiration");
      return;
    }
    void retryImage();
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
          productIds: (shopItems ?? []).map((item) => item.id),
          previewMode: styleSheetImageDataUri ? "style_sheet" : previewMode,
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

  const blockedReason = !profileComplete
    ? "Complete your Style Profile first."
    : !climate
      ? "Still finding today’s weather. Choose a city in the weather panel to continue."
      : null;

  const saveBlockedReason =
    look && !styleSheetImageDataUri && !look.imageDataUri && !savingLook && !lookSaved
      ? "Your look needs its visual before it can be saved."
      : null;

  return (
    <motion.div
      className="atelier-page max-w-5xl"
      variants={cardContainerVariants}
      initial="hidden"
      animate="visible"
    >
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

            <div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
              <div className="w-full sm:max-w-xs">
                <span
                  id="vibe-label"
                  className="mb-2 block text-xs font-medium uppercase tracking-label text-muted-foreground"
                >
                  Today's Mood
                </span>
                <Select value={vibe} onValueChange={(v) => setVibe(v as Vibe)}>
                  <SelectTrigger
                    aria-labelledby="vibe-label"
                    className="h-11 rounded-full border-border bg-card text-sm"
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
              <div className="w-full sm:max-w-2xs">
                <label
                  htmlFor="agenda-input"
                  className="mb-2 block text-xs font-medium uppercase tracking-label text-muted-foreground"
                >
                  Today's plan (optional)
                </label>
                <Input
                  id="agenda-input"
                  value={agenda}
                  onChange={(e) => setAgenda(e.target.value)}
                  placeholder="e.g. Client dinner at 7pm"
                  maxLength={200}
                  className="h-11 rounded-full border-border bg-card text-sm"
                />
              </div>
              <div className="w-full sm:max-w-3xs">
                <label
                  htmlFor="dress-code-input"
                  className="mb-2 block text-xs font-medium uppercase tracking-label text-muted-foreground"
                >
                  Dress code (optional)
                </label>
                <Input
                  id="dress-code-input"
                  value={dressCode}
                  onChange={(e) => setDressCode(e.target.value)}
                  placeholder="e.g. Smart casual"
                  maxLength={80}
                  className="h-11 rounded-full border-border bg-card text-sm"
                />
              </div>
              <div className="w-full sm:max-w-3xs">
                <span
                  id="setting-label"
                  className="mb-2 block text-xs font-medium uppercase tracking-label text-muted-foreground"
                >
                  Setting (optional)
                </span>
                <Select
                  value={indoorOutdoor || undefined}
                  onValueChange={(v) => setIndoorOutdoor(v as "Indoor" | "Outdoor" | "Mixed")}
                >
                  <SelectTrigger
                    aria-labelledby="setting-label"
                    className="h-11 rounded-full border-border bg-card text-sm"
                  >
                    <SelectValue placeholder="Indoor, outdoor, or mixed" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Indoor" className="text-sm">
                      Indoor
                    </SelectItem>
                    <SelectItem value="Outdoor" className="text-sm">
                      Outdoor
                    </SelectItem>
                    <SelectItem value="Mixed" className="text-sm">
                      Mixed
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={generateLook}
                disabled={generating || !profileComplete || !climate || imageLoading}
                aria-describedby={blockedReason ? "generate-blocked" : undefined}
                size="pill"
                className="w-full sm:w-auto whitespace-normal text-center leading-snug"
              >
                {generating ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" /> Composing…
                  </>
                ) : climate ? (
                  <>
                    <Wand2 className="text-accent" aria-hidden="true" /> Create my look —{" "}
                    {climate.tempC}°C {climate.condition}
                  </>
                ) : (
                  <>
                    <Wand2 className="text-accent" aria-hidden="true" /> Create my look
                  </>
                )}
              </Button>
              {blockedReason && (
                <span id="generate-blocked" className="text-sm text-muted-foreground text-pretty">
                  {blockedReason}
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
                  <p role="status" aria-live="polite" className="sr-only">
                    Your look is ready: {look.outfit.headline}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-label text-muted-foreground">
                      {vibe}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-label tabular-nums">
                      Vibe fit {look.vibe_alignment_score}/10
                    </span>
                    {climate && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-label tabular-nums text-muted-foreground">
                        <ClimateGlyph icon={climate.icon} className="size-3" />
                        {climate.label}
                      </span>
                    )}
                  </div>

                  <motion.div variants={resultItemVariants}>
                    <GeneratedLookDetail
                      outfit={look.outfit}
                      hair={look.hair}
                      makeup={look.makeup}
                      media={
                        <div>
                          <OutfitVisual
                            imageDataUri={look.imageDataUri}
                            imageGenerationError={look.imageGenerationError}
                            loading={imageLoading || photoPreviewLoading}
                            headline={look.outfit.headline}
                            onRetry={retryImage}
                            retryDisabled={imageLoading || generating || photoPreviewLoading}
                            label={
                              previewMode === "photo_edit"
                                ? "AI-edited preview of your photo"
                                : "AI-generated outfit inspiration"
                            }
                          />
                          {profile?.photo_consent_at && photoPreviewLoading ? (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Personalizing to your photo…
                            </p>
                          ) : null}
                          {profile?.photo_consent_at &&
                          !photoPreviewLoading &&
                          styleSheetLoading &&
                          !styleSheetImageDataUri ? (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Building your style sheet…
                            </p>
                          ) : null}
                          {profile?.photo_consent_at && !imageLoading && !photoPreviewLoading ? (
                            <div className="mt-3 flex max-w-lg items-center gap-2">
                              {previewMode === "inspiration" ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  loading={photoPreviewLoading}
                                  disabled={generating}
                                  onClick={previewOnMyPhoto}
                                >
                                  Regenerate photo preview
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={photoPreviewLoading || generating}
                                  onClick={backToInspirationImage}
                                >
                                  Back to inspiration image
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                loading={styleSheetLoading}
                                disabled={imageLoading || generating || photoPreviewLoading}
                                onClick={previewStyleSheet}
                              >
                                Generate style sheet
                              </Button>
                            </div>
                          ) : null}
                          {styleSheetImageDataUri ? (
                            <div className="mt-3">
                              <img
                                src={styleSheetImageDataUri}
                                alt="Identity-locked 5-view style sheet of today's recommended look"
                                className="w-full rounded-lg border"
                              />
                            </div>
                          ) : null}
                        </div>
                      }
                    />
                  </motion.div>

                  {shopItems && (
                    <motion.div variants={resultItemVariants}>
                      <ShopThisLookGrid items={shopItems} />
                    </motion.div>
                  )}

                  <motion.div variants={resultItemVariants} className="border-t border-border pt-6">
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        onClick={saveLookToHistory}
                        disabled={
                          savingLook || lookSaved || !(styleSheetImageDataUri || look.imageDataUri)
                        }
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
                      <Button
                        variant="ghost"
                        onClick={generateLook}
                        disabled={imageLoading}
                        size="pill"
                      >
                        <Sparkles aria-hidden="true" /> Try another look
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
                          size="pill"
                        >
                          <Sparkles aria-hidden="true" /> Ask Mila about this look
                        </Button>
                      )}
                    </div>
                    {saveBlockedReason && (
                      <p id="save-blocked" className="sr-only">
                        {saveBlockedReason}
                      </p>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                      Each new look or visual uses one credit.
                    </p>
                  </motion.div>
                </motion.div>
              ) : (
                <div className="py-10 text-center">
                  <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight leading-snug text-balance">
                    Set the mood. Mila will compose the rest.
                  </h2>
                  <p className="text-base text-muted-foreground mt-2 max-w-md mx-auto text-pretty">
                    Each look is composed from first principles - tuned to your palette, body
                    architecture, and the weather outside.
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.section>
      </Card>

      {profile?.color_season && (
        <motion.section variants={cardItemVariants}>
          <DailyPaletteGenerator userColorSeason={profile.color_season} />
        </motion.section>
      )}

      <UpgradeSlotsDialog open={creditPaywallOpen} onOpenChange={setCreditPaywallOpen} />
    </motion.div>
  );
}
