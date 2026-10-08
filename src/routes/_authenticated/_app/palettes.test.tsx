import { describe, expect, test } from "bun:test";
import * as route from "./palettes";

describe("palettes route file", () => {
  test("exports only its Route, like every other route file", () => {
    expect(Object.keys(route)).toEqual(["Route"]);
  });
});
