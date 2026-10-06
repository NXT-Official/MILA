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
});
