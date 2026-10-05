import { createFileRoute } from "@tanstack/react-router";
import { loadLandingContentForRoute } from "@/lib/landing-content.route-loader";
import { CommunityPageView } from "@/components/landing/community-page-view";

export const Route = createFileRoute("/community")({
  head: () => ({ meta: [{ title: "Community — Mila" }] }),
  loader: () => loadLandingContentForRoute(),
  staleTime: 5 * 60 * 1000,
  component: CommunityPage,
});

function CommunityPage() {
  const content = Route.useLoaderData();
  return <CommunityPageView content={content} />;
}
