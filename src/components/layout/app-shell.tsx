import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AvatarInitial } from "@/components/ui/avatar-initial";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { saveLensAnalysis } from "@/components/layout/save-lens-analysis";
import { StudioCameraDrawer } from "@/components/dashboard/studio-camera-drawer";
import { UpgradeSlotsDialog } from "@/components/dashboard/upgrade-slots-dialog";
import { ConciergeContext, type ConciergeLook } from "@/hooks/use-concierge";
import { CurrentLookContext, type CurrentLookSavedRef } from "@/hooks/use-current-look";
import type { GeneratedLook } from "@/lib/generate-outfit.functions";
import { analyzeOutfit } from "@/lib/analyze-outfit.functions";
import { isInsufficientCreditsError } from "@/lib/credits";
import { profileQueryOptions } from "@/lib/queries/profile";
import { creditsQueryOptions } from "@/lib/queries/credits";
import { queryKeys } from "@/constants/query-keys";
import { errorMessage } from "@/lib/utils";
import { SIDEBAR_EXPANDED_STORAGE_KEY } from "@/constants/app";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const [isLensOpen, setIsLensOpen] = useState(false);
  const [creditPaywallOpen, setCreditPaywallOpen] = useState(false);
  const [conciergeLook, setConciergeLook] = useState<ConciergeLook | null>(null);
  const [currentLook, setCurrentLook] = useState<GeneratedLook | null>(null);
  const [styleSheetImageDataUri, setStyleSheetImageDataUri] = useState<string | null>(null);
  const [currentSavedLook, setCurrentSavedLook] = useState<CurrentLookSavedRef | null>(null);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyze = useServerFn(analyzeOutfit);
  const queryClient = useQueryClient();
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
    if (stored === "false") setSidebarExpanded(false);
  }, []);

  function toggleSidebarExpanded() {
    setSidebarExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, String(next));
      return next;
    });
  }

  const { data: profile } = useQuery({
    ...profileQueryOptions(user?.id),
    enabled: !!user?.id,
  });

  const { data: credits } = useQuery(creditsQueryOptions(user?.id));

  async function runLensCapture(file: File) {
    if (!user) return;
    if (!profile?.body_type || !profile?.color_season) {
      toast.error("Complete your Style Profile first.");
      return;
    }
    const toastId = toast.loading("Analyzing your photo…");
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("outfits")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (upErr) throw upErr;
      const {
        data: { publicUrl },
      } = supabase.storage.from("outfits").getPublicUrl(path);
      const result = await analyze({
        data: {
          imageUrl: publicUrl,
          bodyType: profile.body_type,
          colorSeason: profile.color_season,
        },
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(user.id) });
      const savedLook = await saveLensAnalysis(supabase, {
        user_id: user.id,
        image_url: publicUrl,
        analysis_result: result,
        match_score: result.overall_score,
      });
      if (!savedLook) {
        toast.error("We couldn't save this analysis to your history. Please try again.", {
          id: toastId,
        });
        return;
      }
      toast.success("Analysis saved to your history.", {
        id: toastId,
        action: {
          label: "Go to History",
          onClick: () => navigate({ to: "/history", search: { look: savedLook.id } }),
        },
      });
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        toast.dismiss(toastId);
        setCreditPaywallOpen(true);
      } else {
        toast.error(errorMessage(e, "Something went wrong."), { id: toastId });
      }
    }
  }

  const displayName = profile?.full_name?.trim() || user?.email?.split("@")[0] || "Member";

  function openConcierge(look?: ConciergeLook | null) {
    setConciergeLook(look ?? null);
    navigate({ to: "/concierge" });
  }

  return (
    <ConciergeContext.Provider
      value={{ openConcierge, look: conciergeLook, clearLook: () => setConciergeLook(null) }}
    >
      <CurrentLookContext.Provider
        value={{
          look: currentLook,
          setLook: setCurrentLook,
          styleSheetImageDataUri,
          setStyleSheetImageDataUri,
          savedLook: currentSavedLook,
          setSavedLook: setCurrentSavedLook,
        }}
      >
        <div className="min-h-screen flex w-full">
          <Sidebar
            path={path}
            expanded={sidebarExpanded}
            onToggleExpanded={toggleSidebarExpanded}
            onOpenLens={() => setIsLensOpen(true)}
            onOpenConcierge={() => openConcierge()}
            credits={credits}
            displayName={displayName}
          />

          <div className="flex flex-1 min-w-0 flex-col">
            {/* Mobile-only bar — the sidebar above covers this role from md up. z-index scale: header z-40 < mobile tab bar z-50 (mobile-tab-bar.tsx) < Sheet/Dialog overlays z-[60] (ui/sheet.tsx, ui/dialog.tsx). */}
            <header className="md:hidden sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-porcelain/30">
              <div className="h-16 px-4 sm:px-6 flex items-center justify-between gap-6">
                <Link
                  to="/dashboard"
                  className="inline-flex items-center gap-2 font-serif text-xl uppercase tracking-label-xwide text-ink"
                >
                  <img src="/favicon.svg" alt="" className="size-6" />
                  Mila
                </Link>

                <div className="flex items-center gap-2">
                  {credits != null && (
                    <Button asChild variant="glass" size="chip">
                      <Link
                        to="/pricing"
                        aria-label={`${credits} AI credits — view membership plans and credits`}
                      >
                        {credits}
                      </Link>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="glass"
                    size="chip"
                    onClick={() => setIsLensOpen(true)}
                    aria-label="Open the Studio Lens"
                  >
                    <Camera className="size-3.5" strokeWidth={1.75} />
                    Lens
                  </Button>
                  <Link to="/account" aria-label="Your account" className="rounded-full">
                    <AvatarInitial
                      name={displayName}
                      className="size-10 tracking-wide transition-all duration-300 hover:border-porcelain hover:shadow-atelier-soft"
                    />
                  </Link>
                </div>
              </div>
            </header>

            <main className="flex-1 min-w-0 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
              {children}
            </main>
          </div>

          <MobileTabBar
            path={path}
            onOpenLens={() => setIsLensOpen(true)}
            onOpenConcierge={() => openConcierge()}
          />

          <StudioCameraDrawer
            isOpen={isLensOpen}
            onClose={() => setIsLensOpen(false)}
            userId={user?.id ?? null}
            onLookCapture={runLensCapture}
            onPickGallery={() => fileInputRef.current?.click()}
            onInsufficientCredits={() => setCreditPaywallOpen(true)}
          />

          <UpgradeSlotsDialog open={creditPaywallOpen} onOpenChange={setCreditPaywallOpen} />

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                runLensCapture(f);
                e.target.value = "";
              }
            }}
          />
        </div>
      </CurrentLookContext.Provider>
    </ConciergeContext.Provider>
  );
}
