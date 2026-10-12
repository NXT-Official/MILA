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

async function renderPanelWith(props: Partial<Parameters<typeof HeroResultPanel>[0]>) {
  const rootRoute = createRootRoute({
    component: () => (
      <HeroResultPanel
        generating={false}
        look={LOOK}
        vibe="Everyday Casual"
        climate={null}
        profile={{ photo_consent_at: "2026-10-01T00:00:00Z" }}
        styleSheetLoading={false}
        styleSheetImageDataUri={null}
        photoPreviewLoading={false}
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
        {...props}
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

const WAIT = {
  stage: "Choosing pieces",
  detail: "About 2 minutes · you can leave this page",
  line: "Choosing pieces · about 2 minutes · you can leave this page",
};

describe("HeroResultPanel while a generation is being made (R7)", () => {
  test("a look in progress names its stage and that she can leave", async () => {
    const out = await renderPanelWith({ generating: true, look: null, lookWait: WAIT });
    expect(out).toContain("Choosing pieces");
    expect(out).toContain("About 2 minutes · you can leave this page");
    expect(out).toContain('role="status"');
  });

  test("without a wait line the look skeleton keeps today's copy", async () => {
    const out = await renderPanelWith({ generating: true, look: null });
    expect(out).toContain("Visualizing your look…");
    expect(out).not.toContain("you can leave this page");
  });

  test("a style sheet in progress names its stage", async () => {
    const out = await renderPanelWith({
      styleSheetLoading: true,
      styleSheetWait: { ...WAIT, stage: "Drawing your style sheet" },
    });
    expect(out).toContain("Drawing your style sheet");
    expect(out).toContain("About 2 minutes · you can leave this page");
  });

  test("a portrait in progress names its stage", async () => {
    const out = await renderPanelWith({
      photoPreviewLoading: true,
      photoPreviewWait: { ...WAIT, stage: "Dressing your portrait" },
    });
    expect(out).toContain("Dressing your portrait");
  });

  test("a sheet never drawn for this look is offered, not reported as a failure", async () => {
    const out = await renderPanelWith({ styleSheetNotDrawn: true });
    expect(out).not.toContain("couldn&#x27;t be generated");
    expect(out).toContain("Draw style sheet");
    expect(openingTagOfButton(out, "Draw style sheet")).not.toContain(' disabled=""');
  });

  test("a sheet that genuinely failed still says so and offers a retry", async () => {
    const out = await renderPanelWith({ styleSheetNotDrawn: false });
    expect(out).toContain("couldn&#x27;t be generated");
    expect(out).toContain("Retry visual");
  });

  test("new copy carries no em or en dashes", async () => {
    const out = await renderPanelWith({ styleSheetNotDrawn: true });
    const media = out.slice(out.indexOf("atelier-media-frame"), out.indexOf("Draw style sheet"));
    expect(media).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("HeroResultPanel for a look that came back from before today", () => {
  test("shows when it is from, in words, with no dashes", async () => {
    const out = await renderPanelWith({ lookFromLabel: "From last night, 11:40 PM" });
    expect(out).toContain("From last night, 11:40 PM");
  });

  test("a look from today carries no label", async () => {
    expect(await renderPanelWith({ lookFromLabel: null })).not.toContain("From last night");
  });
});

describe("HeroResultPanel states the cost of paid visuals (N1)", () => {
  test("the cost note has an id the visual buttons point to", async () => {
    const out = await renderPanelWith({ styleSheetNotDrawn: true });
    expect(out).toContain(`id="visual-cost-note"`);
    expect(openingTagOfButton(out, "Draw style sheet")).toContain(
      'aria-describedby="visual-cost-note"',
    );
    expect(openingTagOfButton(out, "Generate portrait preview")).toContain(
      'aria-describedby="visual-cost-note"',
    );
  });
});

describe("HeroResultPanel while her last look is being checked (NEW-M1)", () => {
  test("Try another look waits, and says why", async () => {
    const out = await renderPanelWith({ lookCheckReason: "Checking your last look…" });
    const tag = openingTagOfButton(out, "Try another look");
    expect(tag).toContain(' disabled=""');
    expect(tag).toContain('aria-describedby="look-actions-blocked"');
    expect(out).toContain("Checking your last look…");
  });

  test("without a check it is pressable", async () => {
    const out = await renderPanelWith({ lookCheckReason: null });
    expect(openingTagOfButton(out, "Try another look")).not.toContain(' disabled=""');
  });
});

describe("HeroResultPanel while her look is being confirmed (round 5, N-3)", () => {
  test("Save says so and waits", async () => {
    const out = await renderPanelWith({
      styleSheetImageDataUri: "data:image/png;base64,AAAA",
      saveConfirming: true,
    });
    const tag = openingTagOfButton(out, "Confirming your look…");
    expect(tag).toContain(' disabled=""');
  });

  test("otherwise Save is as before", async () => {
    const out = await renderPanelWith({ styleSheetImageDataUri: "data:image/png;base64,AAAA" });
    expect(openingTagOfButton(out, "Save to history")).not.toContain(' disabled=""');
    expect(out).not.toContain("Confirming your look…");
  });
});

describe("HeroResultPanel's save button", () => {
  // Every generation is auto-saved; the button is the retry path and no
  // longer waits on a visual (a look without one can still be saved).
  test("saving is available even before a visual exists", async () => {
    const out = await renderPanel({});
    const tag = openingTagOfButton(out, "Save to history");
    expect(tag).not.toContain(' disabled=""');
  });

  test("saving waits while the style sheet is drawing (no duplicate row)", async () => {
    const out = await renderPanel({ styleSheetLoading: true });
    const tag = openingTagOfButton(out, "Save to history");
    expect(tag).toContain(' disabled=""');
  });

  test("the old 'needs its visual' copy is gone", async () => {
    const out = await renderPanel({});
    expect(out).not.toContain("needs its visual");
  });
});
