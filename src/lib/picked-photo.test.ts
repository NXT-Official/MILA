import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { UNREADABLE_PHOTO_MESSAGE } from "./prepare-image-for-upload";
import { PHOTO_PICKER_ACCEPT, preparePickedPhoto } from "./picked-photo";

const PICKED = new File([new Uint8Array([1, 2, 3])], "IMG_0042.HEIC", { type: "image/heic" });
const PREPARED = new File([new Uint8Array([9])], "IMG_0042.jpg", { type: "image/jpeg" });

describe("PHOTO_PICKER_ACCEPT", () => {
  test("is the list every other photo picker in the app offers", () => {
    expect(PHOTO_PICKER_ACCEPT).toBe("image/jpeg,image/png,image/webp,image/heic,image/heif");
  });
});

describe("preparePickedPhoto", () => {
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test("hands back the downscaled JPEG, not the file that was picked", async () => {
    const seen: File[] = [];
    const result = await preparePickedPhoto(PICKED, async (file) => {
      seen.push(file);
      return PREPARED;
    });

    expect(seen).toEqual([PICKED]);
    expect(result).toEqual({ ok: true, file: PREPARED });
  });

  test("a photo the browser can't open comes back as the friendly line", async () => {
    const result = await preparePickedPhoto(PICKED, async () => {
      throw new Error(UNREADABLE_PHOTO_MESSAGE);
    });

    expect(result).toEqual({ ok: false, message: UNREADABLE_PHOTO_MESSAGE });
  });

  test("an unexpected failure never leaks its own text to the member", async () => {
    const result = await preparePickedPhoto(PICKED, async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'width')");
    });

    expect(result).toEqual({ ok: false, message: UNREADABLE_PHOTO_MESSAGE });
    expect(errorSpy).toHaveBeenCalled();
  });
});
