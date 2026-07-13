import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getPermissions, hasPermission } from "./authorization.ts";

describe("role permissions", () => {
  test("Stewards retain every application permission", () => {
    assert.equal(hasPermission(["admin"], "roles.manage"), true);
    assert.equal(hasPermission(["admin"], "subscriptionPlans.manage"), true);
    assert.equal(hasPermission(["admin"], "moderation.manage"), true);
  });

  test("Moderators are restricted to moderation and support", () => {
    assert.equal(hasPermission(["moderator"], "moderation.manage"), true);
    assert.equal(hasPermission(["moderator"], "support.manage"), true);
    assert.equal(hasPermission(["moderator"], "members.view"), false);
    assert.equal(hasPermission(["moderator"], "roles.manage"), false);
    assert.equal(hasPermission(["moderator"], "subscriptionPlans.manage"), false);
  });

  test("multiple roles produce a deduplicated permission union", () => {
    const permissions = getPermissions(["moderator", "admin", "moderator"]);
    assert.equal(new Set(permissions).size, permissions.length);
    assert.ok(permissions.includes("roles.manage"));
  });

  test("members receive no staff permissions", () => {
    assert.deepEqual(getPermissions([]), []);
  });
});
