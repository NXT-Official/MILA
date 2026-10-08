import { describe, expect, test } from "bun:test";
import { CONVERSATION_TITLE_MAX, conversationTitle, truncateWithEllipsis } from "./concierge-title";

describe("conversationTitle", () => {
  test("collapses whitespace and trims", () => {
    expect(conversationTitle("  what   to\nwear \t today  ")).toBe("what to wear today");
  });

  test("an empty or blank message becomes New conversation", () => {
    expect(conversationTitle("")).toBe("New conversation");
    expect(conversationTitle("  \n ")).toBe("New conversation");
  });

  test("a title of exactly 120 characters is kept whole", () => {
    const title = "a".repeat(CONVERSATION_TITLE_MAX);
    expect(conversationTitle(title)).toBe(title);
  });

  test("a longer title is cut to 120 characters ending in an ellipsis", () => {
    const out = conversationTitle("b".repeat(300));
    expect(out).toHaveLength(CONVERSATION_TITLE_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
});

const hasLoneSurrogate = (s: string) =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe("cutting at an emoji", () => {
  test("a title never splits a surrogate pair at the cut", () => {
    const out = conversationTitle(`${"a".repeat(118)}😀${"b".repeat(10)}`);
    expect(hasLoneSurrogate(out)).toBe(false);
    expect(out.length).toBeLessThanOrEqual(CONVERSATION_TITLE_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  test("a title never splits a joined emoji sequence", () => {
    const family = "👩‍👩‍👧";
    const out = conversationTitle(`${"a".repeat(110)}${family}${family}${"b".repeat(10)}`);
    expect(hasLoneSurrogate(out)).toBe(false);
    expect(out.length).toBeLessThanOrEqual(CONVERSATION_TITLE_MAX);
    expect(out.replace("…", "").endsWith("‍")).toBe(false);
  });

  test("truncateWithEllipsis keeps text that fits, whole", () => {
    expect(truncateWithEllipsis("hello", 5)).toBe("hello");
    const out = truncateWithEllipsis(`${"a".repeat(7)}😀😀`, 9);
    expect(hasLoneSurrogate(out)).toBe(false);
    expect(out.length).toBeLessThanOrEqual(9);
  });
});
