import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { MemberSessionUnavailableError } from "@/lib/auth-session";
import { memberQueryRetry } from "@/lib/queries/member-query";
import {
  GUARD_PROFILE_RETRY,
  loadAuthenticatedViewerState,
  readAgainNow,
  resolveAuthenticatedDestination,
  routeForViewer,
  viewerReadStatus,
} from "./auth";
import { fakeMemberSession, fakeSupabase } from "../../../tests/helpers/fake-member-supabase";

test("members with an incomplete style profile are sent to onboarding", () => {
  expect(resolveAuthenticatedDestination({ isStyleProfileComplete: false })).toBe(
    "/onboarding/style-profile",
  );
});

test("members with a complete style profile land on the dashboard", () => {
  expect(resolveAuthenticatedDestination({ isStyleProfileComplete: true })).toBe("/dashboard");
});

// A failed profile read must never send a finished member to onboarding
// (ruling, 2026-10-07): onboarding is only for a profile that was READ and is
// genuinely incomplete.
describe("routeForViewer", () => {
  test("read OK + incomplete → onboarding", () => {
    expect(routeForViewer({ status: "ready", isStyleProfileComplete: false })).toBe("onboarding");
  });

  test("read OK + complete → stays", () => {
    expect(routeForViewer({ status: "ready", isStyleProfileComplete: true })).toBe("stay");
  });

  test("read failed → stays, with the try-again state (never onboarding)", () => {
    expect(routeForViewer({ status: "failed", isStyleProfileComplete: false })).toBe("unavailable");
  });

  test("still reading → waits", () => {
    expect(routeForViewer({ status: "loading", isStyleProfileComplete: false })).toBe("wait");
  });
});

describe("viewerReadStatus", () => {
  test("a read that failed with nothing cached is a failure, not an empty profile", () => {
    expect(viewerReadStatus({ data: undefined, isError: true })).toBe("failed");
  });

  test("a failed refetch over cached data keeps the cached answer", () => {
    expect(viewerReadStatus({ data: { id: "p" }, isError: true })).toBe("ready");
  });

  test("no data and no error yet (in flight, or paused offline) is still loading", () => {
    expect(viewerReadStatus({ data: undefined, isError: false })).toBe("loading");
  });
});

const COMPLETE = {
  id: "u1",
  full_name: "Member",
  skin_undertone: "Warm",
  color_season: "Autumn",
  body_type: "Hourglass",
  face_shape: "Oval",
  hair_type: "Wavy",
  hair_length: "Medium",
  gender: "Female",
  skin_depth: "Medium",
  color_profile: { season: "Autumn" },
};

function fakeWith(profile: Record<string, unknown> | null) {
  return fakeSupabase({
    session: { data: { session: fakeMemberSession("u1", "tok") }, error: null },
    rows: { profiles: profile ? [profile] : [] },
    memberToken: "tok",
  });
}

describe("loadAuthenticatedViewerState (route guards)", () => {
  test("read OK + incomplete: onboarding", async () => {
    const fake = fakeWith({ id: "u1", full_name: "New member" });
    const viewer = await loadAuthenticatedViewerState(
      new QueryClient(),
      "u1",
      fake.client as never,
    );
    expect(viewer.status).toBe("ready");
    expect(routeForViewer(viewer)).toBe("onboarding");
  });

  test("read OK + complete: stays", async () => {
    const fake = fakeWith(COMPLETE);
    const viewer = await loadAuthenticatedViewerState(
      new QueryClient(),
      "u1",
      fake.client as never,
    );
    expect(viewer.status).toBe("ready");
    expect(routeForViewer(viewer)).toBe("stay");
  });

  test("read failed: never throws, never onboarding", async () => {
    const fake = fakeWith(COMPLETE);
    fake.setSession({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    const viewer = await loadAuthenticatedViewerState(
      new QueryClient(),
      "u1",
      fake.client as never,
    );
    expect(viewer.status).toBe("failed");
    expect(routeForViewer(viewer)).toBe("unavailable");
    expect(viewer.destination).not.toBe("/onboarding/style-profile");
  });
});

describe("route-guard profile read is bounded (navigation never hangs)", () => {
  test("a guard read that keeps failing gives up within a couple of seconds", async () => {
    const fake = fakeWith(COMPLETE);
    fake.setSession({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    const started = Date.now();
    const viewer = await loadAuthenticatedViewerState(
      new QueryClient(),
      "u1",
      fake.client as never,
    );
    expect(viewer.status).toBe("failed");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("the guard's retry is one short retry, not the member queries' long policy", () => {
    expect(GUARD_PROFILE_RETRY).toEqual({ retry: 1, retryDelay: 500 });
  });
});

describe("viewerReadStatus stays 'failed' while it retries (no flicker back to the splash)", () => {
  // query-core 5.101.2 query.ts:710-724: a refetch of a query with no data
  // resets it to `pending` and clears the error, so isError alone flickers.
  test("a retry in flight after a failure is still a failure", () => {
    expect(viewerReadStatus({ data: undefined, isError: false, failureCount: 1 })).toBe("failed");
  });

  test("a fresh refetch after an earlier error is still a failure until data arrives", () => {
    expect(
      viewerReadStatus({ data: undefined, isError: false, failureCount: 0, errorUpdateCount: 2 }),
    ).toBe("failed");
  });

  test("the first attempt, not failed yet, is loading", () => {
    expect(
      viewerReadStatus({ data: undefined, isError: false, failureCount: 0, errorUpdateCount: 0 }),
    ).toBe("loading");
  });
});

describe("a page-level Try again reads now, not after the retry sleep (R-4)", () => {
  // A data-less query that has failed sleeps between retries (memberQueryRetry,
  // up to 30 s). query-core 5.101.2 query.ts:404-419 cancels a running fetch on
  // refetch() only when data is cached; otherwise the refetch joins the sleep.
  function sleepingProfileQuery() {
    const client = new QueryClient();
    const queryKey = ["profile", "u1"];
    const state = { fail: true, calls: 0 };
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn: async () => {
        state.calls += 1;
        if (state.fail) throw new MemberSessionUnavailableError();
        return { id: "u1" };
      },
      retry: memberQueryRetry,
      retryDelay: 2_000,
    });
    const unsubscribe = observer.subscribe(() => {});
    return { client, queryKey, state, observer, unsubscribe };
  }

  async function until(condition: () => boolean) {
    const started = Date.now();
    while (!condition()) {
      if (Date.now() - started > 1_000) throw new Error("condition never held");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  test("readAgainNow cancels the sleeping attempt and reads at once, without flickering to loading", async () => {
    const q = sleepingProfileQuery();
    await until(() => q.state.calls === 1);
    q.state.fail = false;
    const statuses: string[] = [];
    const stop = q.observer.subscribe((result) =>
      statuses.push(viewerReadStatus({ ...result, data: result.data })),
    );
    const outcome = await Promise.race([
      readAgainNow(q.client, q.queryKey).then(() => "read"),
      new Promise((resolve) => setTimeout(() => resolve("still sleeping"), 300)),
    ]);
    expect(outcome).toBe("read");
    expect(q.client.getQueryData(q.queryKey)).toEqual({ id: "u1" });
    expect(q.state.calls).toBe(2);
    expect(statuses).not.toContain("loading");
    stop();
    q.unsubscribe();
  });

  test("control: a plain refetch only joins that sleep", async () => {
    const q = sleepingProfileQuery();
    await until(() => q.state.calls === 1);
    q.state.fail = false;
    const outcome = await Promise.race([
      q.observer.refetch().then(() => "read"),
      new Promise((resolve) => setTimeout(() => resolve("still sleeping"), 300)),
    ]);
    expect(outcome).toBe("still sleeping");
    expect(q.state.calls).toBe(1);
    await q.client.cancelQueries();
    q.unsubscribe();
  });
});
