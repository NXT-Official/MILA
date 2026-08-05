import { expect, test } from "bun:test";
import { resolveAuthenticatedDestination } from "./auth";
import { MODERATOR_HOME, staffBase, STAFF_ROUTE_PERMISSIONS } from "@/lib/authorization";

test("admins land on /admin/dashboard, moderators land in the moderator tree", () => {
  const complete = { isStyleProfileComplete: true };
  // /admin itself is the staff login screen; the dashboard sits behind it.
  expect(resolveAuthenticatedDestination({ ...complete, isAdmin: true })).toBe("/admin/dashboard");
  // A moderator has admin.access but no admin dashboard — sending them to /admin
  // would bounce them straight back out of a tree they can't enter.
  expect(
    resolveAuthenticatedDestination({ ...complete, isAdmin: false, canAccessStaffArea: true }),
  ).toBe(MODERATOR_HOME);
});

test("staff skip onboarding, plain members do not", () => {
  expect(
    resolveAuthenticatedDestination({
      isAdmin: false,
      canAccessStaffArea: true,
      isStyleProfileComplete: false,
    }),
  ).toBe(MODERATOR_HOME);
  expect(resolveAuthenticatedDestination({ isAdmin: false, isStyleProfileComplete: false })).toBe(
    "/onboarding/style-profile",
  );
  expect(resolveAuthenticatedDestination({ isAdmin: false, isStyleProfileComplete: true })).toBe(
    "/dashboard",
  );
});

test("each tree carries its own moderation/support paths at the same permission", () => {
  for (const screen of ["moderation", "support"] as const) {
    const permission = screen === "moderation" ? "moderation.view" : "support.view";
    // Same permission both sides — the tree decides the URL, never the access.
    expect(STAFF_ROUTE_PERMISSIONS[`/admin/${screen}`]).toBe(permission);
    expect(STAFF_ROUTE_PERMISSIONS[`/moderator/${screen}`]).toBe(permission);
  }
  expect(MODERATOR_HOME).toBe("/moderator/moderation");
});

test("staffBase keeps each role on its own URLs", () => {
  expect(staffBase(["admin"])).toBe("/admin");
  expect(staffBase(["moderator"])).toBe("/moderator");
  // An admin who also holds the moderator role still gets admin URLs.
  expect(staffBase(["moderator", "admin"])).toBe("/admin");
  expect(staffBase([])).toBe("/moderator");
});
