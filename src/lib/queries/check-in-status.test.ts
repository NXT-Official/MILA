import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { memberQueryRetry } from "@/lib/queries/member-query";
import type { CheckInStatus } from "@/server/services/check-in";
import { CHECK_IN_STATUS_STALE_MS, checkInStatusQueryOptions } from "./check-in-status";

const USER = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";

const STATUS: CheckInStatus = {
  available: true,
  freeToday: true,
  checkInCost: 0,
  bodyScan: { available: true, free: false, cost: 1 },
};

describe("checkInStatusQueryOptions", () => {
  test("keys on her id, stays fresh for 30 seconds and retries like every member read", () => {
    const options = checkInStatusQueryOptions(USER, async () => STATUS);
    expect(options.queryKey).toEqual(queryKeys.checkInStatus(USER));
    expect(CHECK_IN_STATUS_STALE_MS).toBe(30_000);
    expect(options.staleTime).toBe(30_000);
    expect(options.retry).toBe(memberQueryRetry);
    expect(options.enabled).toBe(true);
  });

  test("asks nothing until she is signed in", () => {
    expect(checkInStatusQueryOptions(undefined, async () => STATUS).enabled).toBe(false);
  });

  test("answers what the server reports, once per key while fresh", async () => {
    let calls = 0;
    const fetchStatus = async () => {
      calls += 1;
      return STATUS;
    };
    const client = new QueryClient();
    expect(await client.fetchQuery(checkInStatusQueryOptions(USER, fetchStatus))).toEqual(STATUS);
    await client.fetchQuery(checkInStatusQueryOptions(USER, fetchStatus));
    expect(calls).toBe(1);
  });
});
