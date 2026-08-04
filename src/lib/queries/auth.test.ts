import { expect, test } from "bun:test";
import { resolveAuthenticatedDestination } from "./auth";
import { MODERATOR_HOME, STAFF_ROUTE_PERMISSIONS } from "@/lib/authorization";

test("admins land on /admin, moderators land in the moderator tree", () => {
  const complete = { isStyleProfileComplete: true };
  expect(resolveAuthenticatedDestination({ ...complete, isAdmin: true })).toBe("/admin");
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

test("the two staff trees are permission-disjoint", () => {
  const adminOnly = Object.entries(STAFF_ROUTE_PERMISSIONS).filter(([path]) =>
    path.startsWith("/admin"),
  );
  const moderator = Object.entries(STAFF_ROUTE_PERMISSIONS).filter(([path]) =>
    path.startsWith("/moderator"),
  );
  // Moderation and support moved out of /admin; nothing may move back without
  // this failing, because a moderator can reach /moderator but never /admin.
  expect(adminOnly.map(([, permission]) => permission)).not.toContain("moderation.view");
  expect(adminOnly.map(([, permission]) => permission)).not.toContain("support.view");
  expect(moderator.map(([path]) => path)).toEqual(["/moderator/moderation", "/moderator/support"]);
  expect(MODERATOR_HOME).toBe("/moderator/moderation");
});
