import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState, loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { getLandingContent } from "@/lib/landing-content.functions";
import { SiteHeader } from "@/components/landing/site-header";
import { HeroReel } from "@/components/landing/hero-reel";
import { HeroSection } from "@/components/landing/hero-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { DossierSection } from "@/components/landing/dossier-section";
import { CommunitySection } from "@/components/landing/community-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { AtelierSplash } from "@/components/layout/atelier-splash";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, data.session.user.id);
    throw redirect({ to: viewer.destination });
  },
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: LandingPage,
});

function LandingPage() {
  const { session, loading } = useAuth();
  const viewer = useAuthenticatedViewerState(session?.user.id);
  const navigate = useNavigate();
  const content = Route.useLoaderData();

  useEffect(() => {
    if (loading || !session || viewer.isLoading) return;
    navigate({ to: viewer.destination });
  }, [loading, session, viewer.isLoading, viewer.destination, navigate]);

  if (session && (loading || viewer.isLoading)) {
    return <AtelierSplash />;
  }

  /* ponytail: fixed nav labels, not the Sanity `kicker`. A kicker is written to
     sit above a heading ("The Style Dossier"); a nav item is a destination and
     wants one plain word. Add a `navLabel` to the landing schema when marketing
     needs to edit these without a deploy. */
  const sections = [
    { id: "how-it-works", label: "How it works" },
    { id: "dossier", label: "Dossier" },
    { id: "dupe-hunter", label: "Dupes" },
    { id: "community", label: "Feed" },
  ];

  return (
    <div className="relative min-h-screen">
      {/* Fixed behind everything; the solid sections below scroll over it. */}
      <HeroReel />

      <div className="relative z-10">
        <SiteHeader sections={sections} />
        <main className="overflow-x-clip">
          {/* The reel is the ground for the whole page: sharp under the hero,
              then washed and blurred from the hero's fade all the way down. */}
          <HeroSection content={content.hero} />

          <HowItWorksSection content={content.howItWorks} />
          <DossierSection content={content.dossier} dupeContent={content.dupeHunter} />
          <CommunitySection content={content.community}>
            <TestimonialsSection testimonials={content.testimonials} />
          </CommunitySection>

          <FinalCtaSection content={content.finalCta} />
        </main>
        <SiteFooter content={content.footer} sections={sections} />
      </div>
    </div>
  );
}
