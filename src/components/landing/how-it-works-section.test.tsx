import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { HowItWorksContent, Testimonial } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { HowItWorksSection } from "./how-it-works-section";
import { TestimonialsSection } from "./testimonials-section";

/** Copy as it appears in the markup: React escapes quotes and ampersands. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

/** The class list of the first `<tag>` in the markup. */
function classOf(markup: string, tag: string) {
  return markup.match(new RegExp(`<${tag}\\b[^>]*class="([^"]*)"`))?.[1] ?? "";
}

/** Step numbers no visitor should see, so their absence proves they are not rendered. */
const CONTENT: HowItWorksContent = {
  ...LANDING_FALLBACK.howItWorks,
  steps: LANDING_FALLBACK.howItWorks.steps.map((step, i) => ({ ...step, number: `N${i}Q` })),
};

const QUOTES: Testimonial[] = LANDING_FALLBACK.testimonials;

describe("HowItWorksSection", () => {
  test("each step is led by its real title, in order, without a step number", () => {
    const out = renderToStaticMarkup(<HowItWorksSection content={CONTENT} />);
    const titles = [...out.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map(([, inner]) => inner);
    expect(titles).toEqual(CONTENT.steps.map((step) => text(step.title)));
    for (const step of CONTENT.steps) {
      expect(out).toContain(`>${text(step.body)}<`);
      expect(out).not.toContain(step.number);
    }
    // The order lives in the list itself.
    expect(out).toContain("<ol");
  });

  test("the heading is left-aligned", () => {
    const out = renderToStaticMarkup(<HowItWorksSection content={CONTENT} />);
    expect(out).toContain(`>${text(CONTENT.heading)}</h2>`);
    expect(out).not.toContain("text-center");
  });
});

describe("TestimonialsSection", () => {
  test("every quote, name and season is shown", () => {
    const out = renderToStaticMarkup(<TestimonialsSection testimonials={QUOTES} />);
    for (const t of QUOTES) {
      expect(out).toContain(text(t.quote));
      expect(out).toContain(text(t.name));
      expect(out).toContain(`>${text(t.season)}<`);
    }
  });

  test("the quotes flow in balanced columns, each kept whole, with nothing to scroll sideways", () => {
    const out = renderToStaticMarkup(<TestimonialsSection testimonials={QUOTES} />);
    expect(classOf(out, "ul")).toContain("sm:columns-2");
    expect(classOf(out, "li")).toContain("break-inside-avoid");
    expect(out).not.toContain("overflow-x");
    expect(out).not.toContain("tabindex");
  });
});

describe("How it works and the testimonials have their own layouts", () => {
  test("neither is the three-column grid, and they differ from each other", () => {
    const steps = classOf(renderToStaticMarkup(<HowItWorksSection content={CONTENT} />), "ol");
    const quotes = classOf(
      renderToStaticMarkup(<TestimonialsSection testimonials={QUOTES} />),
      "ul",
    );
    // Guard: both lists were found.
    expect(steps).not.toBe("");
    expect(quotes).not.toBe("");

    expect(steps).not.toContain("grid-cols-3");
    expect(quotes).not.toContain("grid-cols-3");
    expect(steps).not.toBe(quotes);
  });
});
