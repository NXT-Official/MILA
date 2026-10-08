import { createFileRoute } from "@tanstack/react-router";
import { MARKETING_SEO, pageHead, siteFromMatches } from "@/lib/site-seo";
import {
  loadLandingContentForRoute,
  shouldReloadLandingRoute,
  useRememberServerRendered,
} from "@/lib/landing-content.route-loader";
import { DupeHunterPageView } from "@/components/landing/dupe-hunter-page-view";

export const Route = createFileRoute("/dupe-hunter")({
  head: ({ matches }) =>
    pageHead({ path: "/dupe-hunter", ...MARKETING_SEO["/dupe-hunter"] }, siteFromMatches(matches)),
  loader: loadLandingContentForRoute,
  shouldReload: shouldReloadLandingRoute,
  staleTime: 5 * 60 * 1000,
  component: DupeHunterPage,
});

function DupeHunterPage() {
  const content = Route.useLoaderData();
  useRememberServerRendered(content);
  return <DupeHunterPageView content={content} />;
}
