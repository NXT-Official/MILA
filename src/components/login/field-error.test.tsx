import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FieldError } from "./field-error";

describe("FieldError", () => {
  test("a message under a field is announced politely, not as an alert that interrupts typing", () => {
    const markup = renderToStaticMarkup(<FieldError id="a-error" message="Enter a valid email." />);

    expect(markup).toContain('id="a-error"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("role=");
    expect(markup).toContain("Enter a valid email.");
    expect(markup).toContain("text-destructive");
  });

  test("with no message the live region is already on the page, empty and out of the layout", () => {
    // A live region has to exist before its text changes or readers stay silent.
    const markup = renderToStaticMarkup(<FieldError id="a-error" message={undefined} />);

    expect(markup).toContain('id="a-error"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("sr-only");
    expect(markup).not.toContain("text-destructive");
    expect(markup.replace(/<[^>]*>/g, "")).toBe("");
  });

  test("a message another live region already announces is shown but not announced twice", () => {
    const markup = renderToStaticMarkup(
      <FieldError
        id="form-error"
        message="That did not work. Please try again."
        announce={false}
      />,
    );

    expect(markup).toContain("That did not work. Please try again.");
    expect(markup).not.toContain("aria-live");
    expect(markup).not.toContain("role=");
  });

  test("a silent message with nothing to say renders nothing at all", () => {
    expect(
      renderToStaticMarkup(<FieldError id="form-error" message={undefined} announce={false} />),
    ).toBe("");
  });
});
