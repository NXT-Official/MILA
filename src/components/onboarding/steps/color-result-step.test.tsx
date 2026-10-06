import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext } from "@/hooks/use-auth";
import { SEASONS_MASTER_DATA, SEASON_HEX_MATRIX } from "@/constants/style-profile";
import { ColorResultStep } from "./color-result-step";

const AUTH = {
  user: null,
  session: null,
  loading: false,
  signingOut: false,
  signOut: async () => {},
};

/** A read that came back Spring Light — low contrast, soft, light. */
const SPRING_LIGHT_READ = {
  ...SEASONS_MASTER_DATA.SPRING_LIGHT,
  faceShape: "Oval Frame" as const,
  bodyType: "Hourglass" as const,
  stylistNote: "A light, warm canvas.",
  fullPalette: SEASON_HEX_MATRIX.SPRING_LIGHT,
  detectedLighting: "Daylight",
  confidenceScore: 84,
};

function render() {
  return renderToStaticMarkup(
    <AuthContext.Provider value={AUTH}>
      <QueryClientProvider client={new QueryClient()}>
        <ColorResultStep
          candidate={SPRING_LIGHT_READ}
          existingDossier={null}
          onBack={() => {}}
          onReviewAnother={() => {}}
          onConfirmed={() => {}}
        />
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe("ColorResultStep shows only what her read found", () => {
  const markup = render();

  test("shows the sub-season the read returned", () => {
    expect(markup).toContain("Spring Light / PCCS Light &amp; Soft");
  });

  test("no season-family template card that contradicts the read", () => {
    expect(markup).not.toContain("True Spring");
    expect(markup).not.toContain("Medium-High");
    expect(markup).not.toContain("Sister Season");
    expect(markup).not.toContain("Clear Red");
  });
});
