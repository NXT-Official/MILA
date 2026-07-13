import { createFileRoute } from "@tanstack/react-router";
import { StyleProfile } from "@/components/style-profile/style-profile-page";

export const Route = createFileRoute("/_authenticated/_app/style-profile")({
  component: StyleProfile,
});
