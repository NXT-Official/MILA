import { createFileRoute } from "@tanstack/react-router";
import { MARKETING_SEO, pageHead, siteFromMatches } from "@/lib/site-seo";
import {
  loadLandingContentForRoute,
  shouldReloadLandingRoute,
  useRememberServerRendered,
} from "@/lib/landing-content.route-loader";
import { CommunityPageView } from "@/components/landing/community-page-view";

export const Route = createFileRoute("/community")({
  head: ({ matches }) =>
    pageHead({ path: "/community", ...MARKETING_SEO["/community"] }, siteFromMatches(matches)),
  loader: loadLandingContentForRoute,
  shouldReload: shouldReloadLandingRoute,
  staleTime: 5 * 60 * 1000,
  component: CommunityPage,
});

function CommunityPage() {
  const content = Route.useLoaderData();
  useRememberServerRendered(content);
  return <CommunityPageView content={content} />;
}
