import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pins supabase/migrations/20261008090000_quick_rescan_hair_colour.sql
 * (Wave D plan, section 3.1). The owner applies it; agents never do. These
 * checks read the file, so a later edit that narrows anything fails here
 * before it can reach a database.
 */

const ROOT = join(import.meta.dir, "..", "..");
const MIGRATION = join(
  ROOT,
  "supabase",
  "migrations",
  "20261008090000_quick_rescan_hair_colour.sql",
);
const VERIFY_SCRIPT = join(ROOT, "scripts", "verify-quick-rescan.sql");

/**
 * The SQL with `--` comments removed and string literals blanked to '', so
 * only statements are checked. One left-to-right scan: an apostrophe inside a
 * comment ("Today's") never opens a string, and "--" inside a string never
 * opens a comment.
 */
function statementsOnly(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
    } else if (sql[i] === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i += 1;
      }
      i += 1;
      out += "''";
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out.replace(/\s+/g, " ");
}

function statements(sql: string): string[] {
  return statementsOnly(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("quick-rescan migration", () => {
  const sql = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8") : "";
  const code = statementsOnly(sql);

  test("exists", () => {
    expect(existsSync(MIGRATION)).toBe(true);
  });

  test("is additive: no DROP, DELETE, TRUNCATE or ALTER COLUMN ... TYPE, and REVOKE only on the function it creates", () => {
    expect(code.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/\bDELETE\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code).not.toMatch(/ALTER\s+COLUMN[^;]*\bTYPE\b/i);
    expect(code).not.toMatch(/SET\s+NOT\s+NULL/i);

    const revokes = statements(sql).filter((s) => /^REVOKE\b/i.test(s));
    expect(revokes).toHaveLength(1);
    for (const revoke of revokes) {
      expect(revoke).toMatch(
        /^REVOKE EXECUTE ON FUNCTION public\.release_rate_limit\(TEXT, TIMESTAMPTZ, INTEGER\) FROM PUBLIC, anon, authenticated$/i,
      );
    }
    // The function it revokes is the one this file creates.
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.release_rate_limit\(/i);
  });

  test("is re-runnable: every column is ADD COLUMN IF NOT EXISTS and the constraint is guarded", () => {
    const adds = code.match(/ADD COLUMN\b[^,;]*/gi) ?? [];
    expect(adds).toHaveLength(4);
    for (const add of adds) expect(add).toMatch(/^ADD COLUMN IF NOT EXISTS /i);
    for (const column of [
      "hair_color TEXT",
      "last_check_in_at TIMESTAMPTZ",
      "founding_body_read_at TIMESTAMPTZ",
      "free_check_in_on DATE",
    ]) {
      expect(code).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(code).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = '' AND conrelid = ''::regclass\) THEN ALTER TABLE public\.profiles ADD CONSTRAINT profiles_hair_color_length CHECK \(hair_color IS NULL OR char_length\(hair_color\) BETWEEN 1 AND 40\)/i,
    );
    expect(sql).toContain("conname = 'profiles_hair_color_length'");
  });

  test("grants members UPDATE on hair_color and last_check_in_at only", () => {
    const grants = statements(sql).filter((s) => /^GRANT\b/i.test(s));
    const toMembers = grants.filter((s) => /\bTO\s+(authenticated|anon|PUBLIC)\b/i.test(s));
    expect(toMembers).toEqual([
      "GRANT UPDATE (hair_color, last_check_in_at) ON public.profiles TO authenticated",
    ]);
    // Service-role-only columns are never granted to anyone here.
    for (const grant of grants) {
      expect(grant).not.toMatch(/founding_body_read_at|free_check_in_on/i);
    }
    // The only other grant: the new function, to the service role.
    expect(grants.filter((s) => !toMembers.includes(s))).toEqual([
      "GRANT EXECUTE ON FUNCTION public.release_rate_limit(TEXT, TIMESTAMPTZ, INTEGER) TO service_role",
    ]);
  });

  test("release_rate_limit only lowers the window that was charged, floored at 0", () => {
    expect(code).toMatch(/SECURITY DEFINER SET search_path = ''/i);
    expect(code).toMatch(/SET count = GREATEST\(0, rl\.count - _cost\)/i);
    expect(code).toMatch(/WHERE rl\.key = _key AND rl\.expires_at = _reset_at/i);
  });

  test("creates no table, so no new RLS is owed", () => {
    expect(code).not.toMatch(/CREATE\s+TABLE/i);
  });

  test("ships with its verify script, which rolls itself back", () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true);
    const verify = existsSync(VERIFY_SCRIPT) ? readFileSync(VERIFY_SCRIPT, "utf8") : "";
    expect(verify).toMatch(/^BEGIN;$/m);
    expect(verify.trimEnd()).toMatch(/ROLLBACK;$/);
    expect(verify).toContain("20261008090000_quick_rescan_hair_colour.sql");
  });
});
