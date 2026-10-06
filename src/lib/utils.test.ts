import { describe, expect, it } from "bun:test";
import { cn, errorMessage, relativeTime } from "./utils";

describe("relativeTime", () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it("collapses anything under a minute to now", () => {
    expect(relativeTime(ago(0), now)).toBe("now");
    expect(relativeTime(ago(59), now)).toBe("now");
  });

  it("picks the largest fitting unit", () => {
    expect(relativeTime(ago(60), now)).toBe("1 minute ago");
    expect(relativeTime(ago(3600), now)).toBe("1 hour ago");
    expect(relativeTime(ago(86400), now)).toBe("yesterday");
    expect(relativeTime(ago(604800), now)).toBe("last week");
    expect(relativeTime(ago(31536000), now)).toBe("last year");
  });

  it("handles future timestamps and garbage input", () => {
    expect(relativeTime(new Date(now + 7200_000).toISOString(), now)).toBe("in 2 hours");
    expect(relativeTime("not-a-date", now)).toBe("");
  });
});

describe("errorMessage", () => {
  it("uses an Error's message", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("reads Supabase's PostgrestError, which is not an Error instance", () => {
    const postgrestError = {
      code: "42501",
      message: "permission denied for table saved_palettes",
      details: null,
      hint: null,
    };
    expect(errorMessage(postgrestError, "fallback")).toBe(
      "permission denied for table saved_palettes",
    );
  });

  it("falls back for shapes with nothing useful to show", () => {
    expect(errorMessage({ message: "" }, "fallback")).toBe("fallback");
    expect(errorMessage({ message: 42 }, "fallback")).toBe("fallback");
    expect(errorMessage("just a string", "fallback")).toBe("fallback");
    expect(errorMessage(null, "fallback")).toBe("fallback");
  });
});

describe("cn", () => {
  it("keeps a real text colour when a custom text size is merged with it", () => {
    // text-label is a custom size; as a stock colour class it would win the
    // merge and drop text-surface entirely (Morpessa MW-13).
    expect(cn("bg-ink text-surface", "text-label uppercase")).toBe(
      "bg-ink text-surface text-label uppercase",
    );
  });

  it("still resolves colour-vs-colour and size-vs-size conflicts", () => {
    expect(cn("text-surface", "text-ink")).toBe("text-ink");
    expect(cn("text-label", "text-micro")).toBe("text-micro");
  });
});
