import { createFileRoute } from "@tanstack/react-router";
import { MARKETING_SEO, pageHead, siteFromMatches } from "@/lib/site-seo";
import {
  loadLandingContentForRoute,
  shouldReloadLandingRoute,
  useRememberServerRendered,
} from "@/lib/landing-content.route-loader";
import { MembershipPageView } from "@/components/landing/membership-page-view";

export const Route = createFileRoute("/membership")({
  head: ({ matches }) =>
    pageHead({ path: "/membership", ...MARKETING_SEO["/membership"] }, siteFromMatches(matches)),
  loader: loadLandingContentForRoute,
  shouldReload: shouldReloadLandingRoute,
  staleTime: 5 * 60 * 1000,
  component: MembershipPage,
});

function MembershipPage() {
  const content = Route.useLoaderData();
  useRememberServerRendered(content);
  return <MembershipPageView content={content} />;
}
