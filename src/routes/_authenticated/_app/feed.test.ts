import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The feed route is wired to server functions and the app shell, so it can't
// be rendered under bun:test (see dashboard.test.ts). Its copy is pinned by
// reading the source.
const source = readFileSync(new URL("./feed.tsx", import.meta.url), "utf8");

/** Text between JSX tags and string literals in JSX props: what a member reads. */
function visibleStrings() {
  const jsxText = [...source.matchAll(/>\s*([^<>{}]*[A-Za-z][^<>{}]*)\s*</g)].map(([, t]) =>
    t.trim(),
  );
  const props = [...source.matchAll(/\b(?:title|description|label)="([^"]*)"/g)].map(([, t]) => t);
  return [...jsxText, ...props];
}

describe("feed copy says what the feed is", () => {
  test("there is no circle to follow: the empty feed waits for other members", () => {
    expect(source).not.toMatch(/your circle/i);
    expect(source).toContain('description="As other members post, their looks will land here."');
  });

  test("no em or en dash in anything a member reads", () => {
    // Guard: the scan finds the page's copy.
    expect(visibleStrings()).toContain("Today's looks, in real time");
    expect(visibleStrings().filter((t) => /[–—]/.test(t))).toEqual([]);
  });
});
