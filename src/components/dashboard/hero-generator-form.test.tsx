import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClimateState } from "@/constants/climate";
import { unavailableClimate } from "./climate-fetch";
import { HeroGeneratorForm } from "./hero-generator-form";
import { PHOTO_PREVIEW_BUSY_REASON, STYLE_SHEET_BUSY_REASON } from "./style-sheet-run";

const CLIMATE: ClimateState = {
  label: "24°C Sunny",
  location: "Manila",
  country: "PH",
  icon: "sun",
  tempF: 75,
  tempC: 24,
  condition: "Sunny",
};

function renderForm(overrides: {
  generating?: boolean;
  styleSheetLoading?: boolean;
  photoPreviewLoading?: boolean;
  climate?: ClimateState;
}) {
  return renderToStaticMarkup(
    <HeroGeneratorForm
      vibe="Everyday Casual"
      onVibeChange={() => {}}
      agenda=""
      onAgendaChange={() => {}}
      dressCode=""
      onDressCodeChange={() => {}}
      indoorOutdoor=""
      onIndoorOutdoorChange={() => {}}
      climate={overrides.climate ?? CLIMATE}
      generating={overrides.generating ?? false}
      styleSheetLoading={overrides.styleSheetLoading ?? false}
      photoPreviewLoading={overrides.photoPreviewLoading ?? false}
      profileComplete
      blockedReason={null}
      onGenerate={() => {}}
    />,
  );
}

/** The whole button whose label contains `label`. */
function buttonContaining(markup: string, label: string) {
  const button = (markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((b) =>
    b.includes(label),
  );
  expect(button).toBeDefined();
  return button as string;
}

/** The opening tag of the button whose label contains `label`. */
function openingTagOfButton(markup: string, label: string) {
  const button = buttonContaining(markup, label);
  return button.slice(0, button.indexOf(">") + 1);
}

/** The button's visible words, with the markup stripped. */
function labelOfButton(markup: string, label: string) {
  return buttonContaining(markup, label)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("HeroGeneratorForm while a style sheet is drawing", () => {
  test("Create my look is disabled and says why", () => {
    const out = renderForm({ styleSheetLoading: true });
    const tag = openingTagOfButton(out, "Create my look");
    expect(tag).toContain(' disabled=""');
    expect(tag).toContain('aria-describedby="generate-blocked"');
    expect(out).toContain(`<span id="generate-blocked"`);
    expect(out).toContain(STYLE_SHEET_BUSY_REASON);
  });

  test("Create my look is enabled once the sheet is done", () => {
    const out = renderForm({ styleSheetLoading: false });
    const tag = openingTagOfButton(out, "Create my look");
    expect(tag).not.toContain(' disabled=""');
    expect(out).not.toContain(STYLE_SHEET_BUSY_REASON);
  });
});

describe("HeroGeneratorForm while a portrait preview is rendering", () => {
  test("Create my look is disabled and says why", () => {
    const out = renderForm({ photoPreviewLoading: true });
    const tag = openingTagOfButton(out, "Create my look");
    expect(tag).toContain(' disabled=""');
    expect(tag).toContain('aria-describedby="generate-blocked"');
    expect(out).toContain(`<span id="generate-blocked"`);
    expect(out).toContain(PHOTO_PREVIEW_BUSY_REASON);
    expect(out).not.toContain(STYLE_SHEET_BUSY_REASON);
  });

  test("Create my look is enabled once the portrait is done", () => {
    const out = renderForm({ photoPreviewLoading: false });
    expect(openingTagOfButton(out, "Create my look")).not.toContain(' disabled=""');
    expect(out).not.toContain(PHOTO_PREVIEW_BUSY_REASON);
  });
});

describe("HeroGeneratorForm button label", () => {
  test("quotes a real weather reading", () => {
    expect(labelOfButton(renderForm({}), "Create my look")).toBe("Create my look — 24°C Sunny");
  });

  test("does not dress the weather fallback up as a reading", () => {
    const out = renderForm({ climate: unavailableClimate("Manila", "PH") });
    expect(labelOfButton(out, "Create my look")).toBe("Create my look");
  });
});
