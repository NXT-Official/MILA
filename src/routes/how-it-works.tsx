import { createFileRoute } from "@tanstack/react-router";
import {
  loadLandingContentForRoute,
  shouldReloadLandingRoute,
  useRememberServerRendered,
} from "@/lib/landing-content.route-loader";
import { HowItWorksPageView } from "@/components/landing/how-it-works-page-view";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({ meta: [{ title: "How it Works — Mila" }] }),
  loader: loadLandingContentForRoute,
  shouldReload: shouldReloadLandingRoute,
  staleTime: 5 * 60 * 1000,
  component: HowItWorksPage,
});

function HowItWorksPage() {
  const content = Route.useLoaderData();
  useRememberServerRendered(content);
  return <HowItWorksPageView content={content} />;
}
