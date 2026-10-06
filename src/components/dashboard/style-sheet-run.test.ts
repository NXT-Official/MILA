import { describe, expect, test } from "bun:test";
import { createLatestRun } from "./style-sheet-run";

/** A request the test settles by hand, standing in for a style-sheet render. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createLatestRun", () => {
  test("a run is current until something newer starts", () => {
    const runs = createLatestRun();
    const first = runs.start();
    expect(runs.isCurrent(first)).toBe(true);

    const second = runs.start();
    expect(runs.isCurrent(first)).toBe(false);
    expect(runs.isCurrent(second)).toBe(true);
  });

  test("invalidate leaves no run current", () => {
    const runs = createLatestRun();
    const run = runs.start();
    runs.invalidate();
    expect(runs.isCurrent(run)).toBe(false);
  });

  test("a run started after an invalidate is current again", () => {
    const runs = createLatestRun();
    runs.start();
    runs.invalidate();
    expect(runs.isCurrent(runs.start())).toBe(true);
  });

  test("a late style sheet from the old look never lands on the new look", async () => {
    const runs = createLatestRun();
    let sheetOnScreen: string | null = null;
    let drawing = false;

    // The dashboard's pattern: take a token before the request, apply the
    // result and stop the spinner only if the token is still current.
    async function draw(request: Promise<string>) {
      const run = runs.start();
      drawing = true;
      const sheet = await request;
      if (!runs.isCurrent(run)) return;
      sheetOnScreen = sheet;
      drawing = false;
    }

    const oldLook = deferred<string>();
    const newLook = deferred<string>();
    const oldDraw = draw(oldLook.promise);
    const newDraw = draw(newLook.promise);

    // The old look's sheet arrives while the new look's is still drawing.
    oldLook.resolve("sheet-for-old-look");
    await oldDraw;
    expect(sheetOnScreen).toBeNull();
    expect(drawing).toBe(true);

    newLook.resolve("sheet-for-new-look");
    await newDraw;
    expect(sheetOnScreen).toBe("sheet-for-new-look");
    expect(drawing).toBe(false);
  });

  test("a portrait preview and a style sheet are tracked independently", () => {
    const sheet = createLatestRun();
    const portrait = createLatestRun();
    const sheetRun = sheet.start();
    const portraitRun = portrait.start();

    // A new sheet must not retire the portrait that is still rendering, and a
    // new portrait must not retire the sheet.
    sheet.start();
    expect(sheet.isCurrent(sheetRun)).toBe(false);
    expect(portrait.isCurrent(portraitRun)).toBe(true);

    portrait.invalidate();
    expect(portrait.isCurrent(portraitRun)).toBe(false);
  });

  test("a late portrait from the old look never lands on the new look", async () => {
    const runs = createLatestRun();
    let portraitOnScreen: string | null = null;

    async function render(request: Promise<string>) {
      const run = runs.start();
      const portrait = await request;
      if (!runs.isCurrent(run)) return;
      portraitOnScreen = portrait;
    }

    const oldLook = deferred<string>();
    const oldRender = render(oldLook.promise);
    // Composing the new look retires whatever portrait is still rendering.
    runs.invalidate();
    oldLook.resolve("portrait-for-old-look");
    await oldRender;
    expect(portraitOnScreen).toBeNull();
  });
});
