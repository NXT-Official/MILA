import { useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Coins } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { StudioMembershipDrawer } from "@/components/account/studio-membership-drawer";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { DesktopNav } from "@/components/layout/desktop-nav";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { StudioCameraDrawer } from "@/components/dashboard/studio-camera-drawer";
import { UpgradeSlotsDialog } from "@/components/dashboard/upgrade-slots-dialog";
import { ConciergeContext, type ConciergeLook } from "@/hooks/use-concierge";
import { analyzeOutfit } from "@/lib/analyze-outfit.functions";
import { isInsufficientCreditsError } from "@/lib/credits";
import { profileQueryOptions } from "@/lib/queries/profile";
import { queryKeys } from "@/constants/query-keys";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const [isMembershipOpen, setIsMembershipOpen] = useState(false);
  const [isLensOpen, setIsLensOpen] = useState(false);
  const [creditPaywallOpen, setCreditPaywallOpen] = useState(false);
  const [conciergeLook, setConciergeLook] = useState<ConciergeLook | null>(null);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyze = useServerFn(analyzeOutfit);
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    ...profileQueryOptions(user?.id),
    enabled: !!user?.id,
  });

  const { data: credits } = useQuery({
    queryKey: queryKeys.credits(user?.id),
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("user_entitlements")
        .select("ai_credits")
        .eq("user_id", user.id)
        .maybeSingle();
      return data?.ai_credits ?? 0;
    },
    enabled: !!user,
  });

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
      const { data: savedLook } = await supabase
        .from("outfits")
        .insert({
          user_id: user.id,
          image_url: publicUrl,
          analysis_result: result,
          match_score: result.overall_score,
        })
        .select("id")
        .single();
      toast.success("Analysis saved to your history.", {
        id: toastId,
        action: savedLook
          ? {
              label: "Ask Mila",
              onClick: () =>
                openConcierge({
                  lookId: savedLook.id,
                  imageUrl: publicUrl,
                  title: "Outfit analysis",
                  source: "Studio Lens",
                }),
            }
          : undefined,
      });
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        toast.dismiss(toastId);
        setCreditPaywallOpen(true);
      } else {
        toast.error(e instanceof Error ? e.message : "Something went wrong.", { id: toastId });
      }
    }
  }

  const displayName = profile?.full_name?.trim() || user?.email?.split("@")[0] || "Member";
  const username = user?.email?.split("@")[0] ?? "member";
  const initial = (displayName[0] ?? "M").toUpperCase();

  function openConcierge(look?: ConciergeLook | null) {
    setConciergeLook(look ?? null);
    navigate({ to: "/concierge" });
  }

  return (
    <ConciergeContext.Provider
      value={{ openConcierge, look: conciergeLook, clearLook: () => setConciergeLook(null) }}
    >
      <div className="min-h-screen flex flex-col w-full">
        <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-porcelain/30">
          <div className="max-w-7xl mx-auto h-16 px-5 md:px-8 flex items-center justify-between gap-6 relative">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 font-serif text-xl md:text-2xl uppercase tracking-[0.32em] text-ink"
            >
              <img src="/favicon.svg" alt="" className="size-6 md:h-7 md:w-7" />
              Mila
            </Link>

            <DesktopNav
              path={path}
              onOpenLens={() => setIsLensOpen(true)}
              onOpenConcierge={() => openConcierge()}
            />

            <div className="flex items-center gap-2">
              {credits != null && (
                <Link
                  to="/pricing"
                  aria-label={`${credits} AI credits — view membership plans and credits`}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-porcelain/60 bg-background/60 backdrop-blur text-[10px] uppercase tracking-[0.22em] text-ink hover:border-porcelain transition-colors"
                >
                  <Coins className="size-3.5 text-accent" strokeWidth={1.75} aria-hidden="true" />
                  {credits}
                </Link>
              )}
              <ThemeToggle />
              <button
                type="button"
                onClick={() => setIsLensOpen(true)}
                aria-label="Open the Studio Lens"
                className="md:hidden inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-porcelain/60 bg-background/60 backdrop-blur text-[10px] uppercase tracking-[0.22em] text-ink hover:border-porcelain transition-colors"
              >
                <Camera className="size-3.5" strokeWidth={1.75} />
                Lens
              </button>
              <button
                onClick={() => setIsMembershipOpen(true)}
                aria-label="Open membership"
                className="size-10 rounded-full border border-porcelain/60 bg-linear-to-br from-atelier-champagne/30 to-porcelain/20 flex items-center justify-center font-serif text-sm text-ink tracking-wide transition-all duration-300 hover:shadow-atelier-soft hover:border-porcelain"
              >
                {initial}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>

        <MobileTabBar
          path={path}
          onOpenLens={() => setIsLensOpen(true)}
          onOpenConcierge={() => openConcierge()}
        />

        <StudioMembershipDrawer
          isOpen={isMembershipOpen}
          onClose={() => setIsMembershipOpen(false)}
          credits={credits ?? null}
          user={{
            fullName: displayName,
            username,
            season: profile?.color_season ?? null,
            faceShape: profile?.face_shape ?? null,
            hairType: profile?.hair_type ?? null,
          }}
        />

        <StudioCameraDrawer
          isOpen={isLensOpen}
          onClose={() => setIsLensOpen(false)}
          initialMode="look-analysis"
          userId={user?.id ?? null}
          onLookCapture={(file) => runLensCapture(file)}
          onPickGallery={() => fileInputRef.current?.click()}
          onInsufficientCredits={() => setCreditPaywallOpen(true)}
        />

        <UpgradeSlotsDialog open={creditPaywallOpen} onOpenChange={setCreditPaywallOpen} user={user} />

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
    </ConciergeContext.Provider>
  );
}
