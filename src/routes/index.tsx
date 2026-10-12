import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  routeForViewer,
  useAuthenticatedViewerState,
  loadAuthenticatedViewerState,
} from "@/lib/queries/auth";
import {
  loadLandingContentForRoute,
  shouldReloadLandingRoute,
  useRememberServerRendered,
} from "@/lib/landing-content.route-loader";
import { canonicalTags, siteFromMatches } from "@/lib/site-seo";
import { LandingPageView } from "@/components/landing/landing-page-view";
import { LandingMemberGate } from "@/components/layout/landing-member-gate";
import { AuthReconnecting } from "@/components/layout/auth-reconnecting";
import { MEMBER_ARRIVING_SCRIPT, MEMBER_ARRIVING_STYLE } from "@/lib/landing-member-guard";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, data.session.user.id);
    // A failed profile read decides nothing: the page shows the try-again state.
    if (viewer.status !== "ready") return;
    throw redirect({ to: viewer.destination });
  },
  loader: loadLandingContentForRoute,
  shouldReload: shouldReloadLandingRoute,
  staleTime: 5 * 60 * 1000,
  // Studio-edited SEO. The deepest route's tags win over __root's defaults.
  // The inline script + style run before first paint so a signed-in member
  // never sees the server-rendered landing flash (see landing-member-guard.ts).
  // They ride with the loader data because the landing only renders with it
  // (the loader always resolves, to the fallback copy at worst).
  head: ({ loaderData, matches }) => {
    if (!loaderData) return {};
    const canonical = canonicalTags("/", siteFromMatches(matches));
    return {
      meta: [
        { title: loaderData.seo.title },
        { name: "description", content: loaderData.seo.description },
        { property: "og:title", content: loaderData.seo.title },
        { property: "og:description", content: loaderData.seo.socialDescription },
        ...canonical.meta,
      ],
      links: canonical.links,
      scripts: [{ children: MEMBER_ARRIVING_SCRIPT }],
      styles: [{ children: MEMBER_ARRIVING_STYLE }],
    };
  },
  component: LandingPage,
});

function LandingPage() {
  const { session, loading } = useAuth();
  const userId = session?.user.id;
  const viewer = useAuthenticatedViewerState(userId);
  const route = routeForViewer(viewer);
  const navigate = useNavigate();
  const content = Route.useLoaderData();
  useRememberServerRendered(content);

  useEffect(() => {
    if (loading || !userId) return;
    // Only a profile that was actually read decides where she goes.
    if (route !== "stay" && route !== "onboarding") return;
    // replace: Back from the dashboard must not land here only to bounce on.
    navigate({ to: viewer.destination, replace: true });
  }, [loading, userId, route, viewer.destination, navigate]);

  // Signed in, but her profile could not be read: the calm try-again state,
  // never onboarding and never a raw error.
  if (userId && route === "unavailable") {
    return <AuthReconnecting onRetry={viewer.retry} signInSearch={{}} />;
  }

  // A signed-in member gets the splash for as long as it takes to send her on,
  // never the landing (it used to repaint for the whole navigation).
  return (
    <LandingMemberGate>
      <LandingPageView content={content} />
    </LandingMemberGate>
  );
}
