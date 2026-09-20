import { Bookmark, CheckCircle2, Download, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { motion, type Variants } from "framer-motion";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadImage } from "@/lib/download-image";
import { ClimateGlyph } from "@/components/dashboard/climate-widget";
import type { ClimateState } from "@/constants/climate";
import { OutfitVisual } from "@/components/dashboard/outfit-visual";
import { OutfitResultSkeleton } from "@/components/dashboard/outfit-result-skeleton";
import { GeneratedLookDetail } from "@/components/dashboard/generated-look-detail";
import { ShopThisLookGrid } from "@/components/dashboard/shop-look-grid";
import { EmptyMediaState } from "@/components/dashboard/empty-media-state";
import type { GeneratedLook } from "@/lib/generate-outfit.functions";
import type { DashboardProfile } from "@/lib/queries/profile";
import type { Vibe } from "@/components/dashboard/hero-generator-form";

export function HeroResultPanel({
  generating,
  look,
  vibe,
  climate,
  profile,
  styleSheetLoading,
  styleSheetImageDataUri,
  photoPreviewLoading,
  savingLook,
  lookSaved,
  savedLook,
  resultContainerVariants,
  resultItemVariants,
  onPreviewStyleSheet,
  onPreviewOnMyPhoto,
  onSaveLook,
  onGenerateAnother,
  onAskConcierge,
}: {
  generating: boolean;
  look: GeneratedLook | null;
  vibe: Vibe;
  climate: ClimateState | null;
  profile: Pick<DashboardProfile, "photo_consent_at"> | null | undefined;
  styleSheetLoading: boolean;
  styleSheetImageDataUri: string | null;
  photoPreviewLoading: boolean;
  savingLook: boolean;
  lookSaved: boolean;
  savedLook: { id: string; imageUrl: string } | null;
  resultContainerVariants: Variants;
  resultItemVariants: Variants;
  onPreviewStyleSheet: () => void;
  onPreviewOnMyPhoto: () => void;
  onSaveLook: () => void;
  onGenerateAnother: () => void;
  onAskConcierge: () => void;
}) {
  if (generating) return <OutfitResultSkeleton />;

  if (!look) {
    return (
      <div className="py-10 text-center">
        <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight leading-snug text-balance">
          Set the mood. Mila will compose the rest.
        </h2>
        <p className="text-base text-muted-foreground mt-2 max-w-md mx-auto text-pretty">
          Each look is composed from first principles - tuned to your palette, body architecture,
          and the weather outside.
        </p>
      </div>
    );
  }

  const saveBlockedReason =
    !styleSheetImageDataUri && !look.imageDataUri && !savingLook && !lookSaved
      ? "Your look needs its visual before it can be saved."
      : null;

  return (
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
            <div className="space-y-4">
              {!profile?.photo_consent_at ? (
                <EmptyMediaState
                  className="max-w-lg"
                  message="Add a consented photo above to generate your style sheet."
                />
              ) : styleSheetLoading ? (
                <div className="atelier-media-frame aspect-video max-w-2xl" role="status">
                  <Skeleton className="absolute inset-0 bg-accent-soft/50" />
                  <div className="relative flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                    <Loader2 className="size-5 animate-spin text-ink" aria-hidden="true" />
                    <p className="font-serif text-lg text-foreground">Building your style sheet…</p>
                    <p className="text-xs text-muted-foreground">
                      Rendering your identity-locked 5-view turnaround.
                    </p>
                  </div>
                </div>
              ) : styleSheetImageDataUri ? (
                <div className="relative max-w-2xl">
                  <img
                    src={styleSheetImageDataUri}
                    alt={`Identity-locked 5-view style sheet of ${look.outfit.headline}`}
                    className="w-full rounded-lg border"
                  />
                  <IconButton
                    label="Download style sheet"
                    variant="outline"
                    size="sm"
                    className="absolute right-3 top-3 bg-background/80 backdrop-blur-sm"
                    onClick={() =>
                      downloadImage(
                        styleSheetImageDataUri,
                        `mila-style-sheet-${look.outfit.headline.toLowerCase().replace(/\s+/g, "-")}.jpg`,
                      )
                    }
                  >
                    <Download />
                  </IconButton>
                  <p className="mt-2 text-micro uppercase tracking-label-xwide text-muted-foreground">
                    Identity-locked style sheet
                  </p>
                </div>
              ) : (
                <EmptyMediaState
                  message="The outfit is ready, but the style sheet couldn't be generated."
                  action={
                    <Button
                      variant="outline"
                      size="pill"
                      onClick={onPreviewStyleSheet}
                      disabled={generating}
                    >
                      <RotateCcw aria-hidden="true" />
                      Retry visual
                    </Button>
                  }
                />
              )}

              {profile?.photo_consent_at ? (
                <div className="flex max-w-lg items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={photoPreviewLoading}
                    disabled={generating}
                    onClick={onPreviewOnMyPhoto}
                  >
                    {look.imageDataUri
                      ? "Regenerate portrait preview"
                      : "Generate portrait preview"}
                  </Button>
                </div>
              ) : null}
              {profile?.photo_consent_at &&
              (look.imageDataUri || photoPreviewLoading || look.imageGenerationError) ? (
                <OutfitVisual
                  imageDataUri={look.imageDataUri}
                  imageGenerationError={look.imageGenerationError}
                  loading={photoPreviewLoading}
                  headline={look.outfit.headline}
                  onRetry={onPreviewOnMyPhoto}
                  retryDisabled={generating || photoPreviewLoading}
                  label="AI-edited preview of your photo"
                />
              ) : null}
            </div>
          }
        />
      </motion.div>

      {look.shoppable_picks && (
        <motion.div variants={resultItemVariants}>
          <ShopThisLookGrid items={look.shoppable_picks} />
        </motion.div>
      )}

      <motion.div variants={resultItemVariants} className="border-t border-border pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={onSaveLook}
            disabled={savingLook || lookSaved || !(styleSheetImageDataUri || look.imageDataUri)}
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
          {profile?.photo_consent_at ? (
            <Button
              variant="ghost"
              onClick={onPreviewStyleSheet}
              disabled={styleSheetLoading || generating}
              size="pill"
            >
              {styleSheetLoading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" /> Drawing…
                </>
              ) : (
                <>
                  <RotateCcw aria-hidden="true" /> New visual
                </>
              )}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onGenerateAnother} size="pill">
            <Sparkles aria-hidden="true" /> Try another look
          </Button>
          {savedLook && (
            <Button variant="outline" onClick={onAskConcierge} size="pill">
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
  );
}
