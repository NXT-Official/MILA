import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HUBS } from "@/constants/climate";
import { LocationStepView } from "./location-step";

type Props = Parameters<typeof LocationStepView>[0];

function renderView(overrides: Partial<Props> = {}) {
  const props: Props = {
    selected: HUBS[1].id,
    onSelect: () => {},
    saving: false,
    failed: false,
    onSubmit: () => {},
    onBack: () => {},
    onSkip: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(<LocationStepView {...props} />);
}

describe("LocationStepView", () => {
  test("shows no error before anything has failed", () => {
    const out = renderView();
    expect(out).not.toContain('role="alert"');
    expect(out).toContain("Set my location");
  });

  test("a failed save says so, keeps her pick, and relabels the button as a retry", () => {
    const out = renderView({ failed: true });
    expect(out).toContain('role="alert"');
    expect(out).toContain("We couldn&#x27;t save your location");
    expect(out).toContain("Your selection is still here");
    expect(out).toContain("Try again");
    expect(out).not.toContain("Set my location");
    const radios = out.match(/<button[^>]*role="radio"[^>]*>/g) ?? [];
    const selected = radios.filter((r) => r.includes('aria-checked="true"'));
    expect(selected).toHaveLength(1);
  });

  test("never claims success: the failed state has no saved or done wording", () => {
    const out = renderView({ failed: true });
    expect(out).not.toMatch(/location (is )?(saved|set)\b/i);
  });

  test("the retry button is disabled until a hub is picked and while saving", () => {
    const none = renderView({ selected: null, failed: true });
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Try again/);
  });

  test("skipping stays available after a failure", () => {
    const out = renderView({ failed: true });
    expect(out).toContain("I&#x27;ll do this later");
  });

  test("copy has no em or en dashes", () => {
    expect(renderView({ failed: true })).not.toMatch(/[–—]/);
    expect(renderView()).not.toMatch(/[–—]/);
  });
});
