import { describe, expect, test } from "bun:test";
import { choosePlanPath } from "./choose-plan-path";

describe("choosePlanPath", () => {
  test("a signed-in member goes to the plans page inside the studio", () => {
    // /login bounces members to /dashboard, so sending them there loses the plan they picked.
    expect(choosePlanPath(true)).toBe("/pricing");
  });

  test("a visitor goes to log in or sign up first", () => {
    expect(choosePlanPath(false)).toBe("/login");
  });
});
