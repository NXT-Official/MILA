import { createFileRoute } from "@tanstack/react-router";
import {
  loadLandingContentForRoute,
  shouldReloadLandingRoute,
  useRememberServerRendered,
} from "@/lib/landing-content.route-loader";
import { DupeHunterPageView } from "@/components/landing/dupe-hunter-page-view";

export const Route = createFileRoute("/dupe-hunter")({
  head: () => ({ meta: [{ title: "Dupe Hunter — Mila" }] }),
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
