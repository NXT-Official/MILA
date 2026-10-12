import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BODY_TYPE_INFO } from "@/constants/style-profile";
import { QUIZ_SAVE_ERROR } from "@/lib/style-profile/body-quiz";
import { BodyQuizPanel, BodyTypeQuiz } from "./body-type-quiz";

/** Copy as it appears in markup: React escapes quotes and ampersands. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

const noop = () => {};

function panel(overrides: Partial<Parameters<typeof BodyQuizPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <BodyQuizPanel
      step={1}
      drape={null}
      balance={null}
      saving={false}
      saveError={null}
      onDrape={noop}
      onBalance={noop}
      onStep={noop}
      onStartOver={noop}
      onConfirm={noop}
      {...overrides}
    />,
  );
}

/** The answer tiles on screen: OptionTile buttons carry aria-pressed. */
function answerCount(markup: string) {
  return (markup.match(/aria-pressed="(true|false)"/g) ?? []).length;
}

describe("body type quiz", () => {
  test("the second question offers Fuller through the middle", () => {
    const markup = panel({ step: 2, drape: "waist" });
    expect(markup).toContain("Where do you naturally feel most balanced?");
    expect(markup).toContain("Fuller through the middle");
    expect(markup).toContain("Softness sits around the waist and tummy.");
    // The three answers she already had are still there.
    for (const label of [
      "Shoulders and hips align",
      "Curving at the hips",
      "Stronger upper frame",
    ]) {
      expect(markup).toContain(label);
    }
    expect(answerCount(markup)).toBe(4);
  });

  test("the first question keeps its three answers", () => {
    const markup = panel({ step: 1 });
    expect(markup).toContain("How do your favorite blazers drape?");
    expect(answerCount(markup)).toBe(3);
  });

  test("Fuller through the middle leads to Apple", () => {
    const markup = panel({ step: 3, drape: "relaxed", balance: "middle" });
    expect(markup).toContain("Apple");
    expect(markup).toContain(text(BODY_TYPE_INFO.Apple.tagline));
    expect(markup).toContain(text("That's me"));
  });

  test("a failed save says That didn't save. Try again.", () => {
    const markup = panel({
      step: 3,
      drape: "waist",
      balance: "hips",
      saveError: QUIZ_SAVE_ERROR,
    });
    expect(QUIZ_SAVE_ERROR).toBe("That didn't save. Try again.");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(text("That didn't save. Try again."));
    // Her result is still on screen, ready to try again.
    expect(markup).toContain("Pear");
    expect(markup).toContain(text("That's me"));
  });

  test("no alert while nothing has failed", () => {
    expect(panel({ step: 3, drape: "waist", balance: "hips" })).not.toContain('role="alert"');
  });

  test("the dialog's Close is a 44px target and no text is gold", () => {
    const markup = renderToStaticMarkup(<BodyTypeQuiz onClose={noop} onComplete={noop} />);
    expect(markup).toContain('role="dialog"');
    const close = /<button[^>]*>Close<\/button>/.exec(markup)?.[0] ?? "";
    expect(close).toMatch(/\bmin-h-11\b/);
    expect(close).toMatch(/\bmin-w-11\b/);
    expect(close).toContain('type="button"');
    expect(markup).not.toMatch(/\btext-accent\b/);
    for (const step of [1, 2, 3] as const) {
      expect(panel({ step, drape: "waist", balance: "middle" })).not.toMatch(/\btext-accent\b/);
    }
  });

  test("no visible string has an em or en dash", () => {
    const markups = [
      renderToStaticMarkup(<BodyTypeQuiz onClose={noop} onComplete={noop} />),
      panel({ step: 2, drape: "waist" }),
      panel({ step: 3, drape: "waist", balance: "middle", saveError: QUIZ_SAVE_ERROR }),
    ];
    for (const markup of markups) expect(markup).not.toMatch(/[–—]/);
  });
});
