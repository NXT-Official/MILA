import { describe, expect, test } from "bun:test";
import { Route } from "./callback";

type Validate = (search: Record<string, unknown>) => { next: string };
const validate = Route.options.validateSearch as unknown as Validate;

describe("/auth/callback next", () => {
  test("keeps a safe same-origin return path", () => {
    expect(validate({ next: "/history?look=abc" })).toEqual({ next: "/history?look=abc" });
    expect(validate({ next: "/dashboard" })).toEqual({ next: "/dashboard" });
  });

  test("anything that could leave the site falls back to the dashboard", () => {
    for (const next of [
      "//evil.example/steal",
      "/.//evil.example",
      "/a/..//evil.example",
      "/\\evil.example",
      "/%09/evil.example",
      "https://evil.example",
      undefined,
      42,
    ]) {
      expect({ next, result: validate({ next }) }).toEqual({
        next,
        result: { next: "/dashboard" },
      });
    }
  });
});
