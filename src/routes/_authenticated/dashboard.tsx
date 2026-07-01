import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2, CheckCircle2, Wand2, Bookmark } from "lucide-react";
import { ClimateWidget, ClimateGlyph, type ClimateState } from "@/components/climate-widget";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { analyzeOutfit } from "@/lib/analyze-outfit.functions";
import {
  generateDailyLook,
  type DailyLook,
} from "@/lib/generate-outfit.functions";
import { toast } from "sonner";
import { StylistConciergeDrawer } from "@/components/stylist-concierge-drawer";
import { StudioCameraDrawer, type StudioCameraMode } from "@/components/studio-camera-drawer";
import { UpgradeSlotsDialog } from "@/components/upgrade-slots-dialog";
import { isInsufficientCreditsError } from "@/lib/credits";
import { deriveColorMetrics } from "@/lib/profile-color";
import { DailyPaletteGenerator } from "@/components/wardrobe/DailyPaletteGenerator";
import { motion, type Variants } from "framer-motion";

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

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

const VIBES = [
  "Casual",
  "Business Casual",
  "Business Attire",
  "Formal",
  "Date Night",
] as const;
type Vibe = (typeof VIBES)[number];

function greet() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Dashboard() {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("body_type,color_season,skin_undertone,full_name,color_profile,face_shape,hair_type,beauty_preferences")
        .eq("id", user.id)
        .single();
      if (!data) return { body_type: null, color_season: null, skin_undertone: null, full_name: null, face_shape: null, hair_type: null, beauty_preferences: null };
      const m = deriveColorMetrics(data as any);
      // Prefer the 16-season subSeason value (e.g. "Spring Soft / PCCS Light & Soft")
      // stored in color_profile JSONB over the legacy 4-season mirror column.
      const json = (data as any).color_profile as { subSeason?: string; season?: string; faceShape?: string; hairType?: string } | null;
      const sixteenSeason = json?.subSeason ?? m.season ?? null;

      const normalizeFirstWord = (v: unknown): string | null => {
        if (typeof v !== "string") return null;
        const first = v.trim().split(/\s+/)[0];
        return first ? first : null;
      };

      const topFaceShape = (data as any).face_shape ?? null;
      const jsonFaceShape = normalizeFirstWord(json?.faceShape);
      const faceShape = topFaceShape ?? jsonFaceShape ?? null;
      const faceShapeSource = topFaceShape
        ? "profiles column"
        : jsonFaceShape
          ? "color_profile JSONB fallback"
          : "none";

      const topHairType = (data as any).hair_type ?? null;
      const jsonHairType = (typeof json?.hairType === "string" && json.hairType.trim()) ? json.hairType : null;
      const hairType = topHairType ?? jsonHairType ?? null;
      const hairTypeSource = topHairType
        ? "profiles column"
        : jsonHairType
          ? "color_profile JSONB fallback"
          : "none";

      const built = {
        body_type: data.body_type ?? null,
        color_season: sixteenSeason,
        skin_undertone: m.undertone,
        full_name: data.full_name ?? null,
        face_shape: faceShape,
        hair_type: hairType,
        beauty_preferences: (data as any).beauty_preferences ?? null,
      };
      // eslint-disable-next-line no-console
      console.log("[Dashboard] profile loaded from DB", {
        raw: data,
        derived: built,
        sources: {
          face_shape: `${faceShape ?? "null"} (source: ${faceShapeSource})`,
          hair_type: `${hairType ?? "null"} (source: ${hairTypeSource})`,
        },
      });
      return built;
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const profileComplete = !!(profile?.body_type && profile?.color_season);

  const [generating, setGenerating] = useState(false);
  const [look, setLook] = useState<DailyLook | null>(null);
  const [savingLook, setSavingLook] = useState(false);
  const [lookSaved, setLookSaved] = useState(false);
  const [vibe, setVibe] = useState<Vibe>("Casual");
  const [stylistOpen, setStylistOpen] = useState(false);
  const [creditPaywallOpen, setCreditPaywallOpen] = useState(false);
  const [climate, setClimate] = useState<ClimateState>({
    label: "22°C Mild & Clear",
    location: "—",
    icon: "sun",
    tempC: 22,
    tempF: 72,
    condition: "Sunny",
  });

  const [isLensOpen, setIsLensOpen] = useState(false);
  const [lensMode] = useState<StudioCameraMode>("look-analysis");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingModeRef = useRef<StudioCameraMode>("look-analysis");

  const analyze = useServerFn(analyzeOutfit);
  const generate = useServerFn(generateDailyLook);

  async function generateLook() {
    if (!user || !profile?.body_type || !profile?.color_season) {
      toast.error("Complete your Style Profile first.");
      return;
    }
    setGenerating(true);
    setLook(null);
    setLookSaved(false);
    try {
      const payload = {
          bodyType: profile.body_type,
          colorSeason: profile.color_season,
          skinUndertone: profile.skin_undertone ?? null,
          faceShape: profile.face_shape ?? null,
          hairType: profile.hair_type ?? null,
          beautyPreferences: (profile.beauty_preferences as Record<string, unknown> | null) ?? null,
          weather: `${climate.label} (in ${climate.location})`,
          tempF: climate.tempF,
          tempC: climate.tempC,
          condition: climate.condition,
          location: climate.location,
          vibe,
      };
      // eslint-disable-next-line no-console
      console.log("[Dashboard] generateDailyLook payload →", payload);
      const res = await generate({ data: payload });
      setLook(res);
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
      } else {
        toast.error(e instanceof Error ? e.message : "Couldn't generate a look.");
      }
    } finally {
      setGenerating(false);
    }
  }

  async function saveLookToHistory() {
    if (!user || !look) return;
    setSavingLook(true);
    try {
      const { error } = await supabase.from("outfits").insert({
        user_id: user.id,
        image_url: "",
        analysis_result: {
          type: "daily_look",
          weather: `${climate.label} (${climate.location})`,
          vibe,
          vibe_alignment_score: look.vibe_alignment_score,
          outfit: look.outfit,
          hair: look.hair,
          makeup: look.makeup,
        },
        match_score: null,
      });
      if (error) throw error;
      setLookSaved(true);
      toast.success("Saved to your history.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save look.");
    } finally {
      setSavingLook(false);
    }
  }

  async function handleCapture(f: File) {
    if (!profileComplete) {
      toast.error("Complete your Style Profile first.");
      return;
    }
    await runAnalyzeWith(f);
  }

  async function runAnalyzeWith(f: File) {
    if (!user) return;
    if (!profile?.body_type || !profile?.color_season) return;
    try {
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("outfits").upload(path, f, { contentType: f.type || "image/jpeg" });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("outfits").getPublicUrl(path);
      const result = await analyze({
        data: { imageUrl: publicUrl, bodyType: profile.body_type, colorSeason: profile.color_season },
      });
      await supabase.from("outfits").insert({
        user_id: user.id,
        image_url: publicUrl,
        analysis_result: result,
        match_score: result.overall_score,
      });
      toast.success("Analysis saved to your history.");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  const handleLookCapture = async (file: File) => {
    await handleCapture(file);
  };

  const handlePickGallery = (mode: StudioCameraMode) => {
    pendingModeRef.current = mode;
    fileInputRef.current?.click();
  };

  return (
    <motion.div
      className="atelier-page max-w-5xl"
      variants={cardContainerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.section variants={cardItemVariants} className="relative mb-10 sm:mb-14 overflow-hidden atelier-card" style={{ background: 'linear-gradient(145deg, #F0E6D3 0%, #FAF8F5 60%, #F5F0E8 100%)' }}>
        <div className="pointer-events-none absolute -top-32 -right-20 h-80 w-80 rounded-full bg-atelier-champagne/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-atelier-rose/15 blur-3xl" />

        <div className="relative p-6 sm:p-8 md:p-10">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="atelier-kicker">Today</p>
              <h2 className="atelier-title mt-2">
                {greet()}
                {profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}.
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-md">
                Let Mila compose an ideal OOTD for today's weather, your palette, and your silhouette.
              </p>
            </div>
            <ClimateWidget value={climate} onChange={setClimate} />
          </div>

          <div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
            <div className="w-full sm:max-w-xs">
              <p className="atelier-kicker mb-2">Occasion Vibe Selector</p>
              <Select value={vibe} onValueChange={(v) => setVibe(v as Vibe)}>
                <SelectTrigger className="h-11 rounded-full border-border bg-card/60 backdrop-blur uppercase tracking-[0.18em] text-[11px]">
                  <SelectValue placeholder="Select an occasion" />
                </SelectTrigger>
                <SelectContent>
                  {VIBES.map((v) => (
                    <SelectItem key={v} value={v} className="uppercase tracking-[0.18em] text-[11px]">
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={generateLook}
              disabled={generating || !profileComplete}
              className="w-full sm:w-auto h-12 px-6 rounded-full bg-foreground text-background hover:bg-foreground/90 uppercase tracking-[0.2em] text-xs whitespace-normal text-center leading-snug"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Composing…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2 shrink-0 text-[var(--atelier-gold)]" /> Generate look — {climate.tempC}°C {(climate.label.replace(/^[-\d.]+\s*°[CF]\s*/i, "").split(/[\s,]+/)[0] || climate.condition)}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="aspect-[3/4] rounded-2xl bg-foreground/[0.06] animate-pulse" />
                ))}
              </div>
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
                    <span className="h-1 w-1 rounded-full bg-foreground/40" />
                    <ClimateGlyph icon={climate.icon} className="h-3 w-3" />
                    <span className="text-muted-foreground">{climate.label}</span>
                  </span>
                </div>
                <motion.div variants={resultItemVariants}>
                <LookSection kicker="Outfit" title={look.outfit.headline}>
                  <p className="font-serif text-lg md:text-xl leading-relaxed text-foreground/90">
                    {look.outfit.description}
                  </p>
                  <p className="text-sm text-muted-foreground italic mt-3">
                    Styling notes — {look.outfit.styling_notes}
                  </p>
                </LookSection>
                </motion.div>
                <motion.div variants={resultItemVariants}>
                <LookSection kicker="Hair" title={look.hair.style}>
                  <p className="text-sm text-muted-foreground">
                    {look.hair.execution_tip}
                  </p>
                </LookSection>
                </motion.div>
                <motion.div variants={resultItemVariants}>
                <LookSection kicker="Makeup" title={look.makeup.palette}>
                  <p className="text-sm text-muted-foreground">
                    {look.makeup.details}
                  </p>
                </LookSection>
                </motion.div>
                <motion.div variants={resultItemVariants} className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    onClick={saveLookToHistory}
                    disabled={savingLook || lookSaved}
                    className="rounded-full h-10 px-5 uppercase tracking-[0.2em] text-[11px]"
                  >
                    {lookSaved ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" /> Saved
                      </>
                    ) : savingLook ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving
                      </>
                    ) : (
                      <>
                        <Bookmark className="h-4 w-4 mr-2" /> Save to history
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={generateLook}
                    className="rounded-full h-10 px-5 uppercase tracking-[0.2em] text-[11px]"
                  >
                    <Sparkles className="h-4 w-4 mr-2 text-[var(--atelier-gold)]" /> Try another
                  </Button>
                </motion.div>
              </motion.div>
            ) : (
              <div className="rounded-2xl border border-border bg-card p-10 text-center">
                <p className="atelier-kicker">Awaiting your cue</p>
                <p className="atelier-title mt-2">
                  Pick a vibe, then let Mila prescribe today's OOTD.
                </p>
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
        <motion.section variants={cardItemVariants} className="mb-14 rounded-[20px] bg-card border border-border p-6 md:p-8 shadow-[0_4px_24px_rgba(43,35,28,0.07),0_1px_4px_rgba(43,35,28,0.04)]">
          <DailyPaletteGenerator userColorSeason={profile.color_season} />
        </motion.section>
      )}

      <StylistConciergeDrawer
        open={stylistOpen}
        onOpenChange={setStylistOpen}
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
            if (pendingModeRef.current === "look-analysis") {
              handleLookCapture(f);
            }
            e.target.value = "";
          }
        }}
      />

      <StudioCameraDrawer
        isOpen={isLensOpen}
        onClose={() => setIsLensOpen(false)}
        initialMode={lensMode}
        userId={user?.id ?? null}
        onLookCapture={handleLookCapture}
        onPickGallery={handlePickGallery}
        onInsufficientCredits={() => setCreditPaywallOpen(true)}
      />
    </motion.div>
  );
}

function LookSection({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[20px] border border-border bg-card p-5 md:p-6 shadow-[0_4px_24px_rgba(43,35,28,0.07),0_1px_4px_rgba(43,35,28,0.04)]">
      <p className="atelier-kicker mb-2">{kicker}</p>
      <h3 className="font-serif text-xl md:text-2xl leading-snug mb-3">{title}</h3>
      {children}
    </section>
  );
}
