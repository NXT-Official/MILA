import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The dashboard route is wired to server functions, the app shell and the
// query cache, so it can't be rendered under bun:test. These checks pin the
// ordering rules inside its async handlers by reading the source, the same way
// src/lib/security-boundaries.test.ts pins its guarantees.
const source = readFileSync(new URL("./dashboard.tsx", import.meta.url), "utf8");

/** The text of one handler, from its `async function` line up to the next one. */
function handler(name: string) {
  const start = source.indexOf(`async function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\n  async function ", start + 1);
  const afterwards = next === -1 ? source.length : next;
  return source.slice(start, afterwards);
}

describe("a late portrait preview never lands on a different look", () => {
  test("each preview takes a token before it starts", () => {
    const body = handler("previewOnMyPhoto");
    expect(body).toContain("photoPreviewRun.start()");
  });

  test("the portrait is applied only if its token is still current", () => {
    const body = handler("previewOnMyPhoto");
    const guard = body.indexOf("photoPreviewRun.isCurrent(run)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf("setLook("));
  });

  test("a stale preview cannot toast, stop the spinner or open the paywall", () => {
    const body = handler("previewOnMyPhoto");
    const inCatch = body.slice(body.indexOf("catch (e)"), body.indexOf("finally"));
    expect(inCatch).toContain("photoPreviewRun.isCurrent(run)");
    const inFinally = body.slice(body.indexOf("finally"));
    expect(inFinally).toMatch(/isCurrent\(run\)\)\s*setPhotoPreviewLoading\(false\)/);
  });

  test("composing a new look retires any portrait still rendering", () => {
    const body = handler("generateLook");
    expect(body).toContain("photoPreviewRun.invalidate()");
    expect(body).toContain("setPhotoPreviewLoading(false)");
  });

  test("a new look cannot be started while a portrait is rendering", () => {
    const guard = handler("generateLook").split("\n")[1] ?? "";
    expect(guard).toContain("photoPreviewLoading");
  });
});

describe("a throw while asking for notifications cannot strand a spinner", () => {
  for (const name of ["generateStyleSheetVisual", "previewOnMyPhoto"]) {
    test(`${name} asks inside its try block`, () => {
      const body = handler(name);
      const ask = body.indexOf("requestNotificationPermission()");
      expect(ask).toBeGreaterThan(-1);
      expect(ask).toBeGreaterThan(body.indexOf("try {"));
    });
  }
});
