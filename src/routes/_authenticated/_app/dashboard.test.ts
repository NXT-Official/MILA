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

describe("generation flags survive a tab switch (they live at the app shell)", () => {
  // A member who switches tabs mid-generation unmounts the dashboard. When
  // the flags lived here as useState they reset to idle: the returning member
  // saw no progress, and the re-enabled CTA was one tap from charging a
  // second generation while the first still ran.
  test("the flags are read from the shared look context", () => {
    const block = source.match(/const \{[^}]*\} = useCurrentLook\(\)/)?.[0] ?? "";
    for (const flag of ["generating", "styleSheetLoading", "photoPreviewLoading"]) {
      expect(block).toContain(flag);
    }
  });

  test("none of the flags is still held as route-local state", () => {
    for (const gone of [
      "const [generating, setGenerating] = useState",
      "const [styleSheetLoading, setStyleSheetLoading] = useState",
      "const [photoPreviewLoading, setPhotoPreviewLoading] = useState",
    ]) {
      expect(source).not.toContain(gone);
    }
  });
});

describe("every generated look lands in history automatically", () => {
  test("generateLook auto-saves after the visual attempt — with or without a sheet", () => {
    const body = handler("generateLook");
    const visual = body.indexOf("await generateStyleSheetVisual(");
    const save = body.indexOf("autoSaveLook(outfit, sheetUri)");
    expect(visual).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(-1);
    expect(visual).toBeLessThan(save);
    // No consent is not an early return any more: the look is still saved.
    expect(body).not.toContain("if (!profile.photo_consent_at) return;");
  });

  test("one generation can never produce two rows", () => {
    // The manual path yields to the automatic save while it is in flight.
    expect(handler("saveLookToHistory")).toContain("if (autoSaveInFlightRef.current) return;");
    const body = handler("autoSaveLook");
    expect(body).toContain("autoSaveInFlightRef.current = true;");
    expect(body).toContain("autoSaveInFlightRef.current = false;");
  });

  test("the manual save no longer demands a visual", () => {
    expect(source).not.toContain("needs its visual before it can be saved");
    expect(handler("saveLookToHistory")).toContain("imageDataUri: imageToSave ?? null");
  });
});
