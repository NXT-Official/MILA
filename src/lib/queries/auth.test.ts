import { expect, test } from "bun:test";
import { resolveAuthenticatedDestination } from "./auth";

test("members with an incomplete style profile are sent to onboarding", () => {
  expect(resolveAuthenticatedDestination({ isStyleProfileComplete: false })).toBe(
    "/onboarding/style-profile",
  );
});

test("members with a complete style profile land on the dashboard", () => {
  expect(resolveAuthenticatedDestination({ isStyleProfileComplete: true })).toBe("/dashboard");
});
