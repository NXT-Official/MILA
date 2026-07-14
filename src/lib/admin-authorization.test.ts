import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertAdmin, assertPermission, getCurrentUserRoles } from "./admin.functions";

/**
 * A minimal fake Supabase client covering exactly the two query shapes
 * getCurrentUserRoles issues: profiles.suspended and user_roles.role, both
 * filtered by the given userId. Good enough to exercise the deny-by-default
 * authorization decision without a real database.
 */
function fakeSupabase(opts: { suspended?: boolean; roles?: string[]; missingProfile?: boolean }) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              if (table === "profiles") {
                return {
                  maybeSingle: async () => ({
                    data: opts.missingProfile ? null : { suspended: !!opts.suspended },
                    error: null,
                  }),
                };
              }
              if (table === "user_roles") {
                return Promise.resolve({
                  data: (opts.roles ?? []).map((role) => ({ role })),
                  error: null,
                });
              }
              throw new Error(`unexpected table ${table}`);
            },
          };
        },
      };
    },
  } as never;
}

describe("server-side authorization decisions", () => {
  test("a member (no staff roles) is denied admin access", async () => {
    const supabase = fakeSupabase({ roles: [] });
    await assert.rejects(() => assertAdmin(supabase, "member-id"));
  });

  test("a moderator is denied admin-only actions", async () => {
    const supabase = fakeSupabase({ roles: ["moderator"] });
    await assert.rejects(() => assertAdmin(supabase, "mod-id"));
  });

  test("a moderator is granted moderation permissions", async () => {
    const supabase = fakeSupabase({ roles: ["moderator"] });
    const roles = await assertPermission(supabase, "mod-id", "moderation.manage");
    assert.deepEqual(roles, ["moderator"]);
  });

  test("a moderator is denied member-administration permissions", async () => {
    const supabase = fakeSupabase({ roles: ["moderator"] });
    await assert.rejects(() => assertPermission(supabase, "mod-id", "members.manage"));
  });

  test("an admin passes assertAdmin", async () => {
    const supabase = fakeSupabase({ roles: ["admin"] });
    await assert.doesNotReject(() => assertAdmin(supabase, "admin-id"));
  });

  test("a suspended user is denied even with a stored admin role", async () => {
    const supabase = fakeSupabase({ roles: ["admin"], suspended: true });
    await assert.rejects(() => getCurrentUserRoles(supabase, "suspended-admin-id"), /suspended/i);
  });

  test("a user with no profile row is denied (fail closed)", async () => {
    const supabase = fakeSupabase({ roles: ["admin"], missingProfile: true });
    await assert.rejects(() => getCurrentUserRoles(supabase, "ghost-id"));
  });
});
