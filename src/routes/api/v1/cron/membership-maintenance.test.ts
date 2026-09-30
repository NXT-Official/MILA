import { describe, expect, mock, test } from "bun:test";
import {
  handleMembershipMaintenance,
  type HandleMembershipMaintenanceDeps,
} from "./membership-maintenance";

const SUMMARY = {
  date: "2026-09-30",
  live: 12,
  toppedUp: 12,
  ended: 1,
  reconciled: 0,
  skipped: 0,
  errors: [] as string[],
};

function fakeDeps(overrides: Partial<HandleMembershipMaintenanceDeps> = {}) {
  return {
    secret: "cron-secret",
    run: mock(async () => SUMMARY),
    ...overrides,
  } as HandleMembershipMaintenanceDeps;
}

function get(headers: Record<string, string> = {}) {
  return new Request("https://mila.test/api/v1/cron/membership-maintenance", { headers });
}

describe("GET /api/v1/cron/membership-maintenance", () => {
  test("runs the sweep and answers with its summary when the bearer matches", async () => {
    const deps = fakeDeps();
    const res = await handleMembershipMaintenance(
      get({ authorization: "Bearer cron-secret" }),
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUMMARY);
    expect(deps.run).toHaveBeenCalledTimes(1);
  });

  test("refuses a missing or wrong bearer without running the sweep", async () => {
    const missing = fakeDeps();
    const wrong = fakeDeps();

    expect((await handleMembershipMaintenance(get(), missing)).status).toBe(401);
    expect(
      (await handleMembershipMaintenance(get({ authorization: "Bearer nope" }), wrong)).status,
    ).toBe(401);
    expect(missing.run).not.toHaveBeenCalled();
    expect(wrong.run).not.toHaveBeenCalled();
  });

  test("answers 503 instead of running open when CRON_SECRET isn't configured", async () => {
    const deps = fakeDeps({ secret: undefined });
    const res = await handleMembershipMaintenance(get(), deps);

    expect(res.status).toBe(503);
    expect(deps.run).not.toHaveBeenCalled();
  });

  test("answers 500 when the sweep itself fails", async () => {
    const deps = fakeDeps({
      run: mock(async () => {
        throw new Error("subscriptions not read");
      }),
    });
    const res = await handleMembershipMaintenance(
      get({ authorization: "Bearer cron-secret" }),
      deps,
    );

    expect(res.status).toBe(500);
  });
});
