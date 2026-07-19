import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { CameraCapture } from "@/components/capture/camera-capture";
import { DualCapture } from "@/components/capture/dual-capture";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ExternalLink, Camera, ArrowLeft, ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { findDupes, type DupeHuntResult } from "@/lib/dupe-hunter.functions";
import { createPost } from "@/lib/posts.functions";
import { isInsufficientCreditsError } from "@/lib/credits";
import { queryKeys } from "@/constants/query-keys";

export type StudioCameraMode = "look-analysis" | "dupe-hunter";

interface StudioCameraDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: StudioCameraMode;
  userId?: string | null;
  onLookCapture?: (file: File) => void;
  onPickGallery?: (mode: StudioCameraMode) => void;
  onInsufficientCredits?: () => void;
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

function formatPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
}

export function StudioCameraDrawer({
  isOpen,
  onClose,
  initialMode = "look-analysis",
  userId,
  onLookCapture,
  onPickGallery,
  onInsufficientCredits,
}: StudioCameraDrawerProps) {
  const [mode, setMode] = useState<StudioCameraMode>(initialMode);
  const [dupeLoading, setDupeLoading] = useState(false);
  const [dupeResult, setDupeResult] = useState<DupeHuntResult | null>(null);
  const [inspirationPreview, setInspirationPreview] = useState<string | null>(null);
  const [postingOpen, setPostingOpen] = useState(false);
  const [postingSubmitting, setPostingSubmitting] = useState(false);
  const dupeFileRef = useRef<HTMLInputElement>(null);
  const runDupes = useServerFn(findDupes);
  const submitPost = useServerFn(createPost);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copy = COPY[mode];

  function resetDupeState() {
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
    const localPreview = URL.createObjectURL(file);
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
      const result = await runDupes({ data: { imageUrl: publicUrl } });
      setDupeResult(result);
      if (result.dupes.length === 0) {
        toast.message("No catalog matches yet — try a different angle.");
      }
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        onInsufficientCredits?.();
      } else {
        toast.error(e instanceof Error ? e.message : "Couldn't run the dupe hunter.");
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
      const stamp = Date.now();
      const backPath = `${userId}/back-${stamp}.jpg`;
      const frontPath = `${userId}/front-${stamp}.jpg`;
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.storage.from("posts").upload(backPath, back, { contentType: "image/jpeg" }),
        supabase.storage.from("posts").upload(frontPath, front, { contentType: "image/jpeg" }),
      ]);
      if (e1 || e2) throw new Error(e1?.message || e2?.message || "Upload failed");
      await submitPost({
        data: {
          image_path_back: backPath,
          image_path_front: frontPath,
          caption: caption || null,
        },
      });
      toast.success("Today's OOTD posted — feed unlocked.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.feed(userId) });
      setPostingOpen(false);
      onClose();
      navigate({ to: "/feed" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't post today's OOTD.");
    } finally {
      setPostingSubmitting(false);
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl border-t border-foreground/5 dark:border-white/10 px-6 pt-8 pb-10 max-h-[92vh] overflow-y-auto"
      >
        {postingOpen ? (
          <>
            <SheetHeader className="text-center space-y-2 mb-6">
              <button
                type="button"
                onClick={() => !postingSubmitting && setPostingOpen(false)}
                className="inline-flex items-center gap-1.5 mx-auto text-[10px] uppercase tracking-[0.28em] text-stone hover:text-ink"
              >
                <ArrowLeft className="size-3" /> Back to Lens
              </button>
              <p className="text-[10px] uppercase tracking-[0.42em] text-muted-foreground">
                Daily Drop
              </p>
              <SheetTitle className="font-serif text-3xl md:text-4xl leading-tight">
                Post Today's OOTD
              </SheetTitle>
              <SheetDescription className="max-w-md mx-auto text-sm">
                Two captures, head to toe — your fit, then your face & hair.
              </SheetDescription>
            </SheetHeader>
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
              <p className="text-[10px] uppercase tracking-[0.42em] text-muted-foreground">
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
              className="group mx-auto mb-6 flex max-w-md w-full items-center justify-between gap-4 rounded-2xl border border-porcelain/70 bg-linear-to-r from-atelier-ivory via-background to-atelier-ivory/70 backdrop-blur-xl px-5 py-4 text-left shadow-atelier-soft hover:shadow-atelier-float transition-shadow"
            >
              <span className="flex items-center gap-3">
                <span className="size-10 rounded-full border border-porcelain/70 bg-background flex items-center justify-center">
                  <Camera className="size-4 text-ink" strokeWidth={1.75} />
                </span>
                <span className="flex flex-col">
                  <span className="text-[9px] uppercase tracking-[0.32em] text-stone">
                    Daily Drop
                  </span>
                  <span className="font-serif text-base text-ink">Post Today's OOTD</span>
                </span>
              </span>
              <span className="text-[10px] uppercase tracking-[0.28em] text-stone group-hover:text-ink">
                Dual capture →
              </span>
            </button>
          </>
        )}

        {!postingOpen && (
          <div
            role="tablist"
            aria-label="Lens mode"
            className="mx-auto mb-6 relative grid grid-cols-2 max-w-md rounded-full border border-porcelain/60 bg-background/40 backdrop-blur-xl p-1 shadow-atelier-soft"
          >
            <span
              aria-hidden
              className={cn(
                "absolute top-1 bottom-1 w-[calc(50%-0.25rem)] rounded-full bg-atelier-ivory shadow-atelier-soft transition-transform duration-500 ease-out",
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
                    "relative z-10 py-2.5 text-[10px] uppercase tracking-[0.28em] rounded-full transition-colors duration-300",
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
                  onLookCapture?.(file);
                  onClose();
                }}
                onPickGallery={() => onPickGallery?.("look-analysis")}
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

                {dupeLoading && (
                  <div className="flex flex-col items-center justify-center gap-4 py-12">
                    <div className="relative size-16">
                      <span className="absolute inset-0 rounded-full border border-atelier-champagne/40 animate-ping" />
                      <span className="absolute inset-2 rounded-full border border-atelier-champagne/60 animate-pulse" />
                      <Loader2
                        className="absolute inset-0 m-auto size-5 text-atelier-champagne animate-spin"
                        strokeWidth={1.25}
                      />
                    </div>
                    <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                      Scanning for luxury attributes…
                    </p>
                  </div>
                )}

                {dupeResult && !dupeLoading && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 rounded-2xl border border-porcelain/60 bg-background/60 backdrop-blur p-4">
                      {inspirationPreview && (
                        <img
                          src={inspirationPreview}
                          alt="Your inspiration"
                          className="size-16 rounded-xl object-cover border border-porcelain/60"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.32em] text-muted-foreground">
                          Inspiration
                        </p>
                        <p className="font-serif text-base text-ink truncate">
                          {dupeResult.inspiration.name}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {dupeResult.inspiration.silhouette_tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="text-[9px] uppercase tracking-[0.2em] text-stone px-1.5 py-0.5 rounded-full border border-porcelain/60"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                        {dupeResult.dupes.length} budget alternatives
                      </p>
                      <button
                        type="button"
                        onClick={resetDupeState}
                        className="text-[10px] uppercase tracking-[0.22em] text-stone hover:text-ink"
                      >
                        Hunt again
                      </button>
                    </div>

                    {dupeResult.dupes.length > 0 ? (
                      <Carousel opts={{ align: "start" }}>
                        <CarouselContent className="-ml-3">
                          {dupeResult.dupes.map((d) => (
                            <CarouselItem key={d.id} className="pl-3 basis-[78%] sm:basis-1/2">
                              <div className="h-full rounded-2xl border border-porcelain/60 bg-background/70 backdrop-blur overflow-hidden flex flex-col shadow-atelier-soft">
                                <div className="aspect-3/4 bg-atelier-ivory/60 overflow-hidden">
                                  {d.image_url && (
                                    <img
                                      src={d.image_url}
                                      alt={d.title}
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                      onError={(e) => {
                                        e.currentTarget.style.display = "none";
                                        e.currentTarget.nextElementSibling?.classList.replace(
                                          "hidden",
                                          "flex",
                                        );
                                      }}
                                    />
                                  )}
                                  <div
                                    className={cn(
                                      "h-full w-full flex-col items-center justify-center gap-2 text-stone",
                                      d.image_url ? "hidden" : "flex",
                                    )}
                                  >
                                    <ImageOff className="size-5" strokeWidth={1.5} />
                                    <span className="text-[10px] uppercase tracking-[0.3em]">
                                      Image not available
                                    </span>
                                  </div>
                                </div>
                                <div className="p-4 flex-1 flex flex-col gap-3">
                                  <div className="flex-1">
                                    <p className="font-serif text-sm text-ink leading-snug line-clamp-2">
                                      {d.title}
                                    </p>
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.24em] text-stone">
                                      {formatPrice(d.price, d.currency)}
                                    </p>
                                  </div>
                                  {d.match_reasons[0] && (
                                    <p className="text-[10px] text-muted-foreground line-clamp-2">
                                      {d.match_reasons[0]}
                                    </p>
                                  )}
                                  <a
                                    href={d.affiliate_link}
                                    target="_blank"
                                    rel="noopener noreferrer sponsored"
                                    className="inline-flex items-center justify-center gap-1.5 h-9 rounded-full bg-ink text-atelier-ivory text-[10px] uppercase tracking-[0.28em] hover:bg-ink/90 transition-colors"
                                  >
                                    Shop the Dupe{" "}
                                    <ExternalLink className="size-3" strokeWidth={1.75} />
                                  </a>
                                </div>
                              </div>
                            </CarouselItem>
                          ))}
                        </CarouselContent>
                      </Carousel>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-porcelain/60 p-6 text-center">
                        <p className="font-serif text-base text-ink">
                          No close matches in the catalog yet.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Try a cleaner background or a different angle.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
