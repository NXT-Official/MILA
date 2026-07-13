import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState, loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { DossierSection } from "@/components/landing/dossier-section";
import { DupeHunterSection } from "@/components/landing/dupe-hunter-section";
import { CommunitySection } from "@/components/landing/community-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { SiteFooter } from "@/components/landing/site-footer";

export const Route = createFileRoute("/")({
  // Fast path for client-side navigations only — see the component-level
  // check below for the SSR/hard-refresh case (beforeLoad is skipped
  // server-side since the session lives in localStorage).
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, data.session.user.id);
    throw redirect({ to: viewer.destination });
  },
  component: LandingPage,
});

function LandingPage() {
  const { session, loading } = useAuth();
  const viewer = useAuthenticatedViewerState(session?.user.id);
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !session || viewer.isLoading) return;
    navigate({ to: viewer.destination });
  }, [loading, session, viewer.isLoading, viewer.destination, navigate]);

  // A session exists but we haven't resolved where it belongs yet — avoid
  // flashing marketing content at a signed-in visitor. Signed-out visitors
  // (the common case) skip this entirely once `loading` resolves.
  if (session && (loading || viewer.isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-serif text-2xl tracking-[0.2em] text-muted-foreground animate-pulse">
          ATELIER
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <HeroSection />
      <TestimonialsSection />
      <HowItWorksSection />
      <DossierSection />
      <DupeHunterSection />
      <CommunitySection />
      <FinalCtaSection />
      <SiteFooter />
    </div>
  );
}
