import { createFileRoute } from "@tanstack/react-router";
import { StudioPage } from "@/components/style-profile/studio-page";

export const Route = createFileRoute("/_authenticated/_app/style-profile")({
  component: StudioPage,
});
