import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState, loadAuthenticatedViewerState } from "@/lib/queries/auth";
import {
  loadLandingContentForRoute,
  shouldReloadLandingRoute,
  useRememberServerRendered,
} from "@/lib/landing-content.route-loader";
import { LandingPageView } from "@/components/landing/landing-page-view";
import { AtelierSplash } from "@/components/layout/atelier-splash";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, data.session.user.id);
    throw redirect({ to: viewer.destination });
  },
  loader: loadLandingContentForRoute,
  shouldReload: shouldReloadLandingRoute,
  staleTime: 5 * 60 * 1000,
  // Studio-edited SEO. The deepest route's tags win over __root's defaults.
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [
            { title: loaderData.seo.title },
            { name: "description", content: loaderData.seo.description },
            { property: "og:title", content: loaderData.seo.title },
            { property: "og:description", content: loaderData.seo.socialDescription },
          ],
        }
      : {},
  component: LandingPage,
});

function LandingPage() {
  const { session, loading } = useAuth();
  const viewer = useAuthenticatedViewerState(session?.user.id);
  const navigate = useNavigate();
  const content = Route.useLoaderData();
  useRememberServerRendered(content);

  useEffect(() => {
    if (loading || !session || viewer.isLoading) return;
    navigate({ to: viewer.destination });
  }, [loading, session, viewer.isLoading, viewer.destination, navigate]);

  if (session && (loading || viewer.isLoading)) {
    return <AtelierSplash />;
  }

  return <LandingPageView content={content} />;
}
