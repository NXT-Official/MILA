import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { profileQueryOptions } from "@/lib/queries/profile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { CameraCapture } from "@/components/capture/camera-capture";
import { DualCapture } from "@/components/capture/dual-capture";
import { DupeHunterResults } from "@/components/dashboard/dupe-hunter-results";
import { cn, errorMessage } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, ArrowLeft, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { findDupes, type DupeHuntResult } from "@/lib/dupe-hunter.functions";
import { publishOotd } from "@/lib/publish-ootd";
import { isInsufficientCreditsError } from "@/lib/credits";
import { queryKeys } from "@/constants/query-keys";

type StudioCameraMode = "look-analysis" | "dupe-hunter";

interface StudioCameraDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string | null;
  onLookCapture: (file: File) => void;
  onPickGallery: () => void;
  onInsufficientCredits: () => void;
}

const MODES: { id: StudioCameraMode; label: string }[] = [
  { id: "look-analysis", label: "Style Analysis" },
  { id: "dupe-hunter", label: "Dupe Hunter" },
];

const COPY: Record<StudioCameraMode, { title: string; description: string }> = {
  "look-analysis": {
    title: "Show me the whole look",
    description:
      "Step back so I can see head to toe. I'll tell you what's singing and what to swap.",
  },
  "dupe-hunter": {
    title: "Hunt the luxury dupe",
    description:
      "Snap an inspiration piece — designer bag, coat, shoe. I'll extract the silhouette and surface budget-friendly alternatives.",
  },
};

export function StudioCameraDrawer({
  isOpen,
  onClose,
  userId,
  onLookCapture,
  onPickGallery,
  onInsufficientCredits,
}: StudioCameraDrawerProps) {
  const [mode, setMode] = useState<StudioCameraMode>("look-analysis");
  const [dupeLoading, setDupeLoading] = useState(false);
  const [dupeResult, setDupeResult] = useState<DupeHuntResult | null>(null);
  const [inspirationPreview, setInspirationPreview] = useState<string | null>(null);
  const [postingOpen, setPostingOpen] = useState(false);
  const [postingSubmitting, setPostingSubmitting] = useState(false);
  const dupeFileRef = useRef<HTMLInputElement>(null);
  const inspirationPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (inspirationPreviewRef.current) URL.revokeObjectURL(inspirationPreviewRef.current);
    };
  }, []);
  const runDupes = useServerFn(findDupes);
  const { data: profile } = useQuery({
    ...profileQueryOptions(userId ?? undefined),
    enabled: !!userId,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copy = COPY[mode];

  function resetDupeState() {
    if (inspirationPreviewRef.current) {
      URL.revokeObjectURL(inspirationPreviewRef.current);
      inspirationPreviewRef.current = null;
    }
    setDupeResult(null);
    setInspirationPreview(null);
    setDupeLoading(false);
  }

  async function runDupeHunt(file: File) {
    if (!userId) {
      toast.error("Sign in to use the Dupe Hunter.");
      return;
    }
    setDupeResult(null);
    setDupeLoading(true);
    if (inspirationPreviewRef.current) URL.revokeObjectURL(inspirationPreviewRef.current);
    const localPreview = URL.createObjectURL(file);
    inspirationPreviewRef.current = localPreview;
    setInspirationPreview(localPreview);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("outfits")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (upErr) throw upErr;
      const {
        data: { publicUrl },
      } = supabase.storage.from("outfits").getPublicUrl(path);
      const result = await runDupes({
        data: { imageUrl: publicUrl, region: profile?.delivery_country || undefined },
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(userId) });
      setDupeResult(result);
      if (result.dupes.length === 0) {
        toast.message("No catalog matches yet — try a different angle.");
      }
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        onInsufficientCredits();
      } else {
        toast.error(errorMessage(e, "Couldn't run the dupe hunter."));
      }
      resetDupeState();
    } finally {
      setDupeLoading(false);
    }
  }

  async function handlePostOotd(back: File, front: File, caption: string) {
    if (!userId) {
      toast.error("Sign in to post your OOTD.");
      return;
    }
    setPostingSubmitting(true);
    try {
      await publishOotd({ userId, back, front, caption });
      toast.success("Today's OOTD posted — feed unlocked.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.feed(userId) });
      setPostingOpen(false);
      onClose();
      navigate({ to: "/feed" });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't post today's OOTD."));
    } finally {
      setPostingSubmitting(false);
    }
  }

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (open) return;
        if (dupeLoading) {
          toast.message("Still hunting — hang tight.");
          return;
        }
        onClose();
      }}
    >
      <SheetContent
        side="bottom"
        className="rounded-t-panel border-t border-foreground/5 dark:border-white/10 px-6 pt-8 pb-[max(2.5rem,calc(1rem+env(safe-area-inset-bottom)))] max-h-[92dvh] overflow-y-auto overscroll-contain"
      >
        {postingOpen ? (
          <>
            <SheetHeader className="text-center space-y-2">
              <p className="text-micro uppercase tracking-label-max text-muted-foreground">
                Daily Drop
              </p>
              <SheetTitle className="font-serif text-3xl md:text-4xl leading-tight">
                Post Today's OOTD
              </SheetTitle>
              <SheetDescription className="max-w-md mx-auto text-sm">
                Two captures, head to toe — your fit, then your face & hair.
              </SheetDescription>
            </SheetHeader>
            <div className="text-center my-3">
              <button
                type="button"
                onClick={() => !postingSubmitting && setPostingOpen(false)}
                className="atelier-focus-ring rounded-control inline-flex items-center gap-1.5 mx-auto text-micro uppercase tracking-label-xwide text-muted-foreground hover:text-ink"
              >
                <ArrowLeft className="size-3" /> Back to Lens
              </button>
            </div>
            <div className="max-w-md mx-auto">
              <DualCapture
                onSubmit={handlePostOotd}
                onCancel={() => setPostingOpen(false)}
                submitting={postingSubmitting}
              />
            </div>
          </>
        ) : (
          <>
            <SheetHeader className="text-center space-y-3 mb-6">
              <p className="text-micro uppercase tracking-label-max text-muted-foreground">
                The Studio Lens
              </p>
              <SheetTitle className="font-serif text-3xl md:text-4xl leading-tight">
                {copy.title}
              </SheetTitle>
              <SheetDescription className="max-w-md mx-auto text-sm leading-relaxed">
                {copy.description}
              </SheetDescription>
            </SheetHeader>

            <button
              type="button"
              onClick={() => setPostingOpen(true)}
              className="atelier-focus-ring group mx-auto mb-6 flex max-w-md w-full items-center justify-between gap-4 rounded-control border border-border bg-linear-to-r from-canvas via-background to-canvas/70 px-5 py-4 text-left shadow-paper hover:shadow-raised transition-shadow"
            >
              <span className="flex items-center gap-3">
                <span className="size-10 rounded-full border border-border bg-background flex items-center justify-center">
                  <Camera className="size-4 text-ink" strokeWidth={1.75} />
                </span>
                <span className="flex flex-col">
                  <span className="text-nano uppercase tracking-label-xwide text-muted-foreground">
                    Daily Drop
                  </span>
                  <span className="font-serif text-base text-ink">Post Today's OOTD</span>
                </span>
              </span>
              <span className="text-micro uppercase tracking-label-xwide text-muted-foreground group-hover:text-ink flex items-center gap-1">
                Dual capture <ArrowRight className="size-3.5" strokeWidth={1.75} />
              </span>
            </button>
          </>
        )}

        {!postingOpen && (
          <div
            role="tablist"
            aria-label="Lens mode"
            className="mx-auto mb-6 relative grid grid-cols-2 max-w-md rounded-full border border-border bg-canvas p-1 shadow-paper"
          >
            <span
              aria-hidden
              className={cn(
                "absolute top-1 bottom-1 w-[calc(50%-0.25rem)] rounded-full bg-canvas shadow-paper transition-transform duration-300 ease-editorial",
                mode === "dupe-hunter" ? "translate-x-[calc(100%+0.25rem)]" : "translate-x-0",
              )}
            />
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => {
                    setMode(m.id);
                    if (m.id !== "dupe-hunter") resetDupeState();
                  }}
                  className={cn(
                    "relative z-10 min-h-11 px-2 text-xs uppercase tracking-label-xwide rounded-full transition-colors duration-300",
                    active
                      ? "text-ink font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        )}

        {!postingOpen && (
          <div className="max-w-xl mx-auto">
            {mode === "look-analysis" && (
              <CameraCapture
                onCapture={(file) => {
                  onLookCapture(file);
                  onClose();
                }}
                onPickGallery={onPickGallery}
              />
            )}

            {mode === "dupe-hunter" && (
              <div className="space-y-6">
                {!dupeResult && !dupeLoading && (
                  <CameraCapture
                    onCapture={(file) => runDupeHunt(file)}
                    onPickGallery={() => dupeFileRef.current?.click()}
                  />
                )}

                <input
                  ref={dupeFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      runDupeHunt(f);
                      e.target.value = "";
                    }
                  }}
                />

                <DupeHunterResults
                  loading={dupeLoading}
                  result={dupeResult}
                  inspirationPreview={inspirationPreview}
                  onReset={resetDupeState}
                />
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
