import { useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Camera, LayoutGrid, Palette, Images, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { StudioMembershipDrawer } from "@/components/studio-membership-drawer";
import { StudioCameraDrawer, type StudioCameraMode } from "@/components/studio-camera-drawer";
import { StylistConciergeDrawer } from "@/components/stylist-concierge-drawer";
import { UpgradeSlotsDialog } from "@/components/upgrade-slots-dialog";
import { analyzeOutfit } from "@/lib/analyze-outfit.functions";
import { isInsufficientCreditsError } from "@/lib/credits";
import { deriveColorMetrics } from "@/lib/profile-color";

const topNavItems: { to: string; label: string }[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/feed", label: "Feed" },
];

const mobileTabItems: { to: string; label: string; icon: typeof LayoutGrid }[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/feed", label: "Feed", icon: Images },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const [isMembershipOpen, setIsMembershipOpen] = useState(false);
  const [isLensOpen, setIsLensOpen] = useState(false);
  const [isConciergeOpen, setIsConciergeOpen] = useState(false);
  const [creditPaywallOpen, setCreditPaywallOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyze = useServerFn(analyzeOutfit);

  // Shared queries — keyed identically to dashboard/style-profile so cache is reused.
  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("body_type,color_season,skin_undertone,full_name,face_shape,hair_type,color_profile")
        .eq("id", user.id)
        .single();
      if (!data) return { body_type: null, color_season: null, skin_undertone: null, full_name: null, face_shape: null, hair_type: null };
      const m = deriveColorMetrics(data as any);
      return {
        body_type: data.body_type ?? null,
        color_season: m.season,
        skin_undertone: m.undertone,
        full_name: data.full_name ?? null,
        face_shape: (data as any).face_shape ?? null,
        hair_type: (data as any).hair_type ?? null,
      };
    },
    enabled: !!user,
  });

  async function runLensCapture(file: File) {
    if (!user) return;
    if (!profile?.body_type || !profile?.color_season) {
      toast.error("Complete your Style Profile first.");
      return;
    }
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("outfits")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("outfits").getPublicUrl(path);
      const result = await analyze({
        data: {
          imageUrl: publicUrl,
          bodyType: profile.body_type,
          colorSeason: profile.color_season,
        },
      });
      await supabase.from("outfits").insert({
        user_id: user.id,
        image_url: publicUrl,
        analysis_result: result,
        match_score: result.overall_score,
      });
      toast.success("Analysis saved to your history.");
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
      } else {
        toast.error(e instanceof Error ? e.message : "Something went wrong.");
      }
    }
  }

  const displayName = profile?.full_name?.trim() || user?.email?.split("@")[0] || "Member";
  const username = user?.email?.split("@")[0] ?? "member";
  const initial = (displayName[0] ?? "M").toUpperCase();

  return (
    <div className="min-h-screen flex flex-col w-full">
      {/* Sticky glassmorphic top navigation */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-porcelain/30">
        <div className="max-w-7xl mx-auto h-16 px-5 md:px-8 flex items-center justify-between gap-6 relative">
          <Link
            to="/dashboard"
            className="font-serif text-xl md:text-2xl uppercase tracking-[0.32em] text-ink"
          >
            Mila
          </Link>

          <nav className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-10">
            {topNavItems.map((it) => {
              const active = path === it.to;
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  className={cn(
                    "text-xs uppercase tracking-[0.2em] transition-colors",
                    active ? "text-[var(--atelier-gold)]" : "text-stone hover:text-ink",
                  )}
                >
                  {it.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setIsLensOpen(true)}
              className="text-xs uppercase tracking-[0.2em] text-stone hover:text-ink transition-colors"
            >
              Lens
            </button>
            <Link
              to="/style-profile"
              className={cn(
                "text-xs uppercase tracking-[0.2em] transition-colors",
                path === "/style-profile" ? "text-[var(--atelier-gold)]" : "text-stone hover:text-ink",
              )}
            >
              Studio
            </Link>
            <button
              type="button"
              onClick={() => setIsConciergeOpen(true)}
              className="text-xs uppercase tracking-[0.2em] text-stone hover:text-ink transition-colors"
            >
              Concierge
            </button>
            {isAdmin && (
              <Link
                to="/admin"
                className={cn(
                  "text-xs uppercase tracking-[0.2em] transition-colors",
                  path === "/admin" ? "text-[var(--atelier-gold)]" : "text-stone hover:text-ink",
                )}
              >
                Admin
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsLensOpen(true)}
              aria-label="Open the Studio Lens"
              className="md:hidden inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-porcelain/60 bg-background/60 backdrop-blur text-[10px] uppercase tracking-[0.22em] text-ink hover:border-porcelain transition-colors"
            >
              <Camera className="h-3.5 w-3.5" strokeWidth={1.5} />
              Lens
            </button>
            <button
              onClick={() => setIsMembershipOpen(true)}
              aria-label="Open membership"
            className="h-10 w-10 rounded-full border border-porcelain/60 bg-gradient-to-br from-atelier-champagne/30 to-porcelain/20 flex items-center justify-center font-serif text-sm text-ink tracking-wide transition-all duration-300 hover:shadow-atelier-soft hover:border-porcelain"
            >
              {initial}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-w-0 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </main>

      {/* Mobile floating luxury tab bar */}
      <nav
        className="md:hidden fixed left-3 right-3 z-50 flex items-center justify-around rounded-[28px] px-5 py-2.5"
        style={{
          bottom: "calc(0.75rem + env(safe-area-inset-bottom))",
          background: "rgba(28, 24, 20, 0.85)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        {mobileTabItems.map((it) => {
          const active = path === it.to;
          const Icon = it.icon;

          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "relative flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[9px] uppercase tracking-[0.18em] transition-colors",
                active ? "text-[var(--atelier-gold)]" : "text-white/45",
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
              <span>{it.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setIsLensOpen(true)}
          className="relative flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[9px] uppercase tracking-[0.18em] text-white/45"
        >
          <Camera className="h-[18px] w-[18px]" strokeWidth={1.5} />
          <span>Lens</span>
        </button>
        <Link
          to="/style-profile"
          className={cn(
            "relative flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[9px] uppercase tracking-[0.18em] transition-colors",
            path === "/style-profile" ? "text-[var(--atelier-gold)]" : "text-white/45",
          )}
        >
          <Palette className="h-[18px] w-[18px]" strokeWidth={1.5} />
          <span>Studio</span>
        </Link>
        <button
          type="button"
          onClick={() => setIsConciergeOpen(true)}
          className="relative flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[9px] uppercase tracking-[0.18em] text-white/45"
        >
          <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.5} />
          <span>Concierge</span>
        </button>
      </nav>

      <StudioMembershipDrawer
        isOpen={isMembershipOpen}
        onClose={() => setIsMembershipOpen(false)}
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

      <StylistConciergeDrawer
        open={isConciergeOpen}
        onOpenChange={setIsConciergeOpen}
        item={null}
        profile={{
          bodyType: profile?.body_type ?? null,
          colorSeason: profile?.color_season ?? null,
          skinUndertone: profile?.skin_undertone ?? null,
        }}
        onInsufficientCredits={() => setCreditPaywallOpen(true)}
      />

      <UpgradeSlotsDialog
        open={creditPaywallOpen}
        onOpenChange={setCreditPaywallOpen}
        variant="credits"
      />

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
  );
}
