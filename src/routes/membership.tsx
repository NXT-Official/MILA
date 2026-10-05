import { createFileRoute } from "@tanstack/react-router";
import {
  loadLandingContentForRoute,
  shouldReloadLandingRoute,
  useRememberServerRendered,
} from "@/lib/landing-content.route-loader";
import { MembershipPageView } from "@/components/landing/membership-page-view";

export const Route = createFileRoute("/membership")({
  head: () => ({ meta: [{ title: "Membership — Mila" }] }),
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
