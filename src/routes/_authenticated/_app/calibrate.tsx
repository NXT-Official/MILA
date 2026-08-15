import { createFileRoute } from "@tanstack/react-router";
import { CalibratePage } from "@/components/style-profile/calibrate-page";

export const Route = createFileRoute("/_authenticated/_app/calibrate")({
  component: CalibratePage,
});
