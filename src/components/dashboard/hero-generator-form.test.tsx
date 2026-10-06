import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClimateState } from "@/constants/climate";
import { HeroGeneratorForm } from "./hero-generator-form";
import { STYLE_SHEET_BUSY_REASON } from "./style-sheet-run";

const CLIMATE: ClimateState = {
  label: "24°C Sunny",
  location: "Manila",
  country: "PH",
  icon: "sun",
  tempF: 75,
  tempC: 24,
  condition: "Sunny",
};

function renderForm(overrides: { generating?: boolean; styleSheetLoading?: boolean }) {
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
      climate={CLIMATE}
      generating={overrides.generating ?? false}
      styleSheetLoading={overrides.styleSheetLoading ?? false}
      profileComplete
      blockedReason={null}
      onGenerate={() => {}}
    />,
  );
}

/** The opening tag of the button whose label contains `label`. */
function openingTagOfButton(markup: string, label: string) {
  const button = (markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((b) =>
    b.includes(label),
  );
  expect(button).toBeDefined();
  return (button as string).slice(0, (button as string).indexOf(">") + 1);
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
