import { expect, test } from "bun:test";
import { resolveAuthenticatedDestination } from "./auth";

test("an incomplete style profile is finished before the dashboard opens", () => {
  expect(resolveAuthenticatedDestination({ isStyleProfileComplete: false })).toBe(
    "/onboarding/style-profile",
  );
  expect(resolveAuthenticatedDestination({ isStyleProfileComplete: true })).toBe("/dashboard");
});
