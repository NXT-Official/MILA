import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { GeneratedLook } from "@/lib/generate-outfit.functions";
import { HeroResultPanel } from "./hero-result-panel";
import { PHOTO_PREVIEW_BUSY_REASON, STYLE_SHEET_BUSY_REASON } from "./style-sheet-run";

const LOOK: GeneratedLook = {
  outfit: {
    headline: "Linen shirt and tailored shorts",
    description: "A light, breathable set for a warm day.",
    styling_notes: "Roll the sleeves once.",
  },
  hair: { style: "Loose waves", execution_tip: "Air dry, then diffuse." },
  makeup: null,
  vibe_alignment_score: 8,
  imageDataUri: null,
};

async function renderPanel(busy: { styleSheetLoading?: boolean; photoPreviewLoading?: boolean }) {
  const rootRoute = createRootRoute({
    component: () => (
      <HeroResultPanel
        generating={false}
        look={LOOK}
        vibe="Everyday Casual"
        climate={null}
        profile={{ photo_consent_at: "2026-10-01T00:00:00Z" }}
        styleSheetLoading={busy.styleSheetLoading ?? false}
        styleSheetImageDataUri={null}
        photoPreviewLoading={busy.photoPreviewLoading ?? false}
        savingLook={false}
        lookSaved={false}
        savedLook={null}
        resultContainerVariants={{}}
        resultItemVariants={{}}
        onPreviewStyleSheet={() => {}}
        onPreviewOnMyPhoto={() => {}}
        onSaveLook={() => {}}
        onGenerateAnother={() => {}}
        onAskConcierge={() => {}}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

/** The opening tag of the button whose label contains `label`. */
function openingTagOfButton(markup: string, label: string) {
  const button = (markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((b) =>
    b.includes(label),
  );
  expect(button).toBeDefined();
  return (button as string).slice(0, (button as string).indexOf(">") + 1);
}

describe("HeroResultPanel while a style sheet is drawing", () => {
  test("Try another look is disabled and says why", async () => {
    const out = await renderPanel({ styleSheetLoading: true });
    const tag = openingTagOfButton(out, "Try another look");
    expect(tag).toContain(' disabled=""');
    expect(tag).toContain('aria-describedby="look-actions-blocked"');
    expect(out).toContain(`<p id="look-actions-blocked"`);
    expect(out).toContain(STYLE_SHEET_BUSY_REASON);
  });

  test("the style sheet's own redraw button is disabled too", async () => {
    const out = await renderPanel({ styleSheetLoading: true });
    expect(openingTagOfButton(out, "Drawing…")).toContain(' disabled=""');
  });

  test("Try another look is enabled once the sheet is done", async () => {
    const out = await renderPanel({});
    const tag = openingTagOfButton(out, "Try another look");
    expect(tag).not.toContain(' disabled=""');
    expect(tag).not.toContain("aria-describedby");
    expect(out).not.toContain(STYLE_SHEET_BUSY_REASON);
  });
});

describe("HeroResultPanel while a portrait preview is rendering", () => {
  test("Try another look is disabled and says why", async () => {
    const out = await renderPanel({ photoPreviewLoading: true });
    const tag = openingTagOfButton(out, "Try another look");
    expect(tag).toContain(' disabled=""');
    expect(tag).toContain('aria-describedby="look-actions-blocked"');
    expect(out).toContain(`<p id="look-actions-blocked"`);
    expect(out).toContain(PHOTO_PREVIEW_BUSY_REASON);
    expect(out).not.toContain(STYLE_SHEET_BUSY_REASON);
  });

  test("a sheet and a portrait drawing together report the sheet", async () => {
    const out = await renderPanel({ styleSheetLoading: true, photoPreviewLoading: true });
    expect(out).toContain(STYLE_SHEET_BUSY_REASON);
    expect(out).not.toContain(PHOTO_PREVIEW_BUSY_REASON);
  });

  test("Try another look is enabled once the portrait is done", async () => {
    const out = await renderPanel({});
    const tag = openingTagOfButton(out, "Try another look");
    expect(tag).not.toContain(' disabled=""');
    expect(tag).not.toContain("aria-describedby");
    expect(out).not.toContain(PHOTO_PREVIEW_BUSY_REASON);
  });
});
