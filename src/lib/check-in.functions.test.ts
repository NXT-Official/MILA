import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCheckInStatus, runBodyScan, runCheckIn } from "./check-in.functions";

/**
 * The three web entry points are thin server-function wrappers: their logic is
 * tested in the services. What can go wrong here is the wiring (a wrong
 * method, a missing auth middleware, the wrong validator, or a handler that
 * drops her id), so that is what this checks: the method at runtime, the rest
 * from the source, block by block.
 */

const source = readFileSync(join(import.meta.dir, "check-in.functions.ts"), "utf8");

/** The source of one `export const <name> = createServerFn(...)` chain. */
function block(name: string): string {
  const start = source.indexOf(`export const ${name} = createServerFn(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("export const ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

const methodOf = (fn: unknown) => (fn as { method?: unknown }).method;

describe("check-in server functions", () => {
  test("posts the reads and gets the status", () => {
    expect(methodOf(runCheckIn)).toBe("POST");
    expect(methodOf(runBodyScan)).toBe("POST");
    expect(methodOf(getCheckInStatus)).toBe("GET");
  });

  test("every entry point runs as her, behind requireSupabaseAuth", () => {
    for (const name of ["runCheckIn", "getCheckInStatus", "runBodyScan"]) {
      expect(block(name)).toContain(".middleware([requireSupabaseAuth])");
    }
  });

  test("each validates with its own service's schema and hands her client, id and input to it", () => {
    const checkIn = block("runCheckIn");
    expect(checkIn).toContain(".validator((input: unknown) => CheckInInput.parse(input))");
    expect(checkIn).toContain("runCheckInForUser(context.supabase, context.userId, data)");

    const scan = block("runBodyScan");
    expect(scan).toContain(".validator((input: unknown) => BodyScanInput.parse(input))");
    expect(scan).toContain("runBodyScanForUser(context.supabase, context.userId, data)");

    const status = block("getCheckInStatus");
    expect(status).not.toContain(".validator(");
    expect(status).toContain("getCheckInStatusForUser(context.supabase, context.userId)");
  });
});
