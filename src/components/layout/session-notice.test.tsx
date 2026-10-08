import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionNotice } from "./session-notice";

describe("SessionNotice (mid-session reconnecting, never unmounts her page)", () => {
  const html = renderToStaticMarkup(<SessionNotice onRetry={() => {}} />);

  test("says calmly that she is still signed in, as a live status", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Reconnecting");
    expect(html).toContain("still signed in");
    expect(html).not.toMatch(/[–—]/);
  });

  test("offers Try again as a real button with a 44px target", () => {
    expect(html).toMatch(/<button[^>]*type="button"[^>]*min-h-11[^>]*>[^<]*Try again/);
  });

  test("is a small fixed note, not a full-screen takeover", () => {
    expect(html).toContain("fixed");
    expect(html).not.toContain("min-h-screen");
  });
});

describe("SessionNotice on phones (R-5)", () => {
  test("sits above the mobile tab bar using the safe area, and drops to the corner from md up", () => {
    const html = renderToStaticMarkup(<SessionNotice onRetry={() => {}} />);
    expect(html).toContain("bottom-[calc(6rem+env(safe-area-inset-bottom))]");
    expect(html).toContain("md:bottom-4");
  });
});
