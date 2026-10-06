import { afterEach, describe, expect, test } from "bun:test";
import { fitWithin, jpegFilename, prepareImageForUpload } from "./prepare-image-for-upload";

const FRIENDLY = "We couldn't open that photo. Please choose a JPEG or PNG.";

describe("fitWithin", () => {
  test("scales a landscape photo so the long edge hits the limit", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  test("scales a portrait photo so the long edge hits the limit", () => {
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  test("never upscales a small photo", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  test("leaves a photo that is exactly at the limit alone", () => {
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  test("rounds to whole pixels and keeps at least one", () => {
    expect(fitWithin(3001, 2001, 1600)).toEqual({ width: 1600, height: 1067 });
    expect(fitWithin(10000, 1, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe("jpegFilename", () => {
  test("swaps the extension for .jpg", () => {
    expect(jpegFilename("IMG_1234.HEIC")).toBe("IMG_1234.jpg");
    expect(jpegFilename("selfie.png")).toBe("selfie.jpg");
  });

  test("only drops the last extension", () => {
    expect(jpegFilename("my.best.look.webp")).toBe("my.best.look.jpg");
  });

  test("adds .jpg when there is no extension", () => {
    expect(jpegFilename("photo")).toBe("photo.jpg");
  });

  test("falls back to a plain name when nothing is left", () => {
    expect(jpegFilename("")).toBe("photo.jpg");
    expect(jpegFilename(".png")).toBe("photo.jpg");
  });
});

/**
 * bun test has no DOM, so the browser pieces are stubbed on globalThis for the
 * length of one test and put back afterwards.
 */
const restorers: Array<() => void> = [];

function stubGlobal(name: string, value: unknown) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, name);
  const previous = Reflect.get(globalThis, name);
  Reflect.set(globalThis, name, value);
  restorers.push(() => {
    if (had) Reflect.set(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  });
}

afterEach(() => {
  while (restorers.length) restorers.pop()?.();
});

type FakeCanvas = {
  width: number;
  height: number;
  fills: string[];
  draws: unknown[][];
  blobArgs: unknown[];
};

function stubCanvas(blob: Blob | null): FakeCanvas {
  const canvas: FakeCanvas = { width: 0, height: 0, fills: [], draws: [], blobArgs: [] };
  const ctx = {
    set fillStyle(value: string) {
      canvas.fills.push(value);
    },
    fillRect: () => undefined,
    drawImage: (...args: unknown[]) => canvas.draws.push(args),
    imageSmoothingQuality: "low",
  };
  const element = {
    get width() {
      return canvas.width;
    },
    set width(v: number) {
      canvas.width = v;
    },
    get height() {
      return canvas.height;
    },
    set height(v: number) {
      canvas.height = v;
    },
    getContext: () => ctx,
    toBlob: (cb: (b: Blob | null) => void, type: string, quality: number) => {
      canvas.blobArgs = [type, quality];
      cb(blob);
    },
  };
  stubGlobal("document", { createElement: () => element });
  return canvas;
}

function stubBitmap(width: number, height: number) {
  const calls: { file: unknown; options: unknown }[] = [];
  const closed = { value: false };
  const bitmap = {
    width,
    height,
    close: () => {
      closed.value = true;
    },
  };
  stubGlobal("createImageBitmap", async (file: unknown, options: unknown) => {
    calls.push({ file, options });
    return bitmap;
  });
  return { bitmap, calls, closed };
}

const phonePhoto = () => new File([new Uint8Array(8)], "IMG_0042.HEIC", { type: "image/heic" });

describe("prepareImageForUpload", () => {
  test("downscales to a JPEG file named after the original", async () => {
    const bitmapStub = stubBitmap(4000, 3000);
    const canvas = stubCanvas(new Blob([new Uint8Array(4)], { type: "image/jpeg" }));

    const out = await prepareImageForUpload(phonePhoto());

    expect(out.name).toBe("IMG_0042.jpg");
    expect(out.type).toBe("image/jpeg");
    expect(bitmapStub.calls[0].options).toEqual({ imageOrientation: "from-image" });
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    expect(canvas.draws[0]).toEqual([bitmapStub.bitmap, 0, 0, 1600, 1200]);
    expect(canvas.blobArgs).toEqual(["image/jpeg", 0.85]);
    expect(bitmapStub.closed.value).toBe(true);
  });

  test("paints a white backdrop so transparent PNGs do not turn black", async () => {
    stubBitmap(100, 100);
    const canvas = stubCanvas(new Blob([new Uint8Array(4)]));

    await prepareImageForUpload(new File([new Uint8Array(4)], "a.png", { type: "image/png" }));

    expect(canvas.fills).toEqual(["#fff"]);
  });

  test("honours maxEdge and quality overrides", async () => {
    stubBitmap(4000, 3000);
    const canvas = stubCanvas(new Blob([new Uint8Array(4)]));

    await prepareImageForUpload(phonePhoto(), { maxEdge: 1000, quality: 0.6 });

    expect([canvas.width, canvas.height]).toEqual([1000, 750]);
    expect(canvas.blobArgs).toEqual(["image/jpeg", 0.6]);
  });

  test("tells the member in plain words when the browser cannot decode the file", async () => {
    stubGlobal("createImageBitmap", async () => {
      throw new Error("The source image could not be decoded.");
    });
    stubGlobal("Image", undefined);

    await expect(prepareImageForUpload(phonePhoto())).rejects.toThrow(FRIENDLY);
  });

  test("falls back to an image element when createImageBitmap is missing", async () => {
    stubGlobal("createImageBitmap", undefined);
    const revoked: string[] = [];
    stubGlobal("URL", {
      createObjectURL: () => "blob:fake",
      revokeObjectURL: (u: string) => revoked.push(u),
    });
    class FakeImage {
      naturalWidth = 2400;
      naturalHeight = 1200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    stubGlobal("Image", FakeImage);
    const canvas = stubCanvas(new Blob([new Uint8Array(4)]));

    const out = await prepareImageForUpload(
      new File([new Uint8Array(4)], "wide.webp", { type: "image/webp" }),
    );

    expect(out.name).toBe("wide.jpg");
    expect([canvas.width, canvas.height]).toEqual([1600, 800]);
    expect(revoked).toEqual(["blob:fake"]);
  });

  test("reports the friendly message when the fallback image cannot load either", async () => {
    stubGlobal("createImageBitmap", undefined);
    stubGlobal("URL", { createObjectURL: () => "blob:fake", revokeObjectURL: () => undefined });
    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    stubGlobal("Image", BrokenImage);

    await expect(prepareImageForUpload(phonePhoto())).rejects.toThrow(FRIENDLY);
  });

  test("reports the friendly message when the canvas cannot produce a JPEG", async () => {
    stubBitmap(100, 100);
    stubCanvas(null);

    await expect(prepareImageForUpload(phonePhoto())).rejects.toThrow(FRIENDLY);
  });
});
