import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { isMemberSessionUnavailable } from "@/lib/auth-session";
import { memberQueryRetry, MEMBER_SESSION_RETRIES } from "./member-query";
import { profileQueryOptions } from "./profile";
import { mySubscriptionQueryOptions } from "./subscriptions";
import { dashboardLookStatsQueryOptions } from "./dashboard-stats";
import { profileUsernameQueryOptions } from "./profile-username";
import { savedPalettesQueryOptions } from "./saved-palettes";
import { savedProductsQueryOptions } from "./saved-products";
import { fakeMemberSession, fakeSupabase } from "../../../tests/helpers/fake-member-supabase";

const USER = "u1";
const TOKEN = "member-token";

const ROWS = {
  profiles: [{ id: USER, full_name: "Member", username: "member", color_season: "Autumn" }],
  subscriptions: [
    {
      plan_id: "p1",
      status: "active",
      current_period_end: "2999-01-01T00:00:00Z",
      cancel_at_period_end: false,
      paddle_subscription_id: "sub_1",
    },
  ],
  subscription_plans: [
    {
      title: "Atelier",
      credits_included: 10,
      price_amount: 1000,
      currency: "USD",
      billing_interval: "month",
    },
  ],
  outfits: [{ id: "o1", image_url: null, match_score: 90, created_at: "2026-10-07T10:00:00Z" }],
  saved_palettes: [],
  saved_products: [],
};

type Factory = (client: never) => {
  queryKey: readonly unknown[];
  queryFn?: unknown;
  retry?: unknown;
};

const QUERIES: Array<[string, Factory]> = [
  ["profile", (client) => profileQueryOptions(USER, client)],
  ["subscription", (client) => mySubscriptionQueryOptions(USER, client)],
  ["look stats", (client) => dashboardLookStatsQueryOptions(USER, client)],
  ["username", (client) => profileUsernameQueryOptions(USER, client)],
  ["saved palettes", (client) => savedPalettesQueryOptions(USER, client)],
  ["saved pieces", (client) => savedProductsQueryOptions(USER, client)],
];

function setup() {
  return fakeSupabase({
    session: { data: { session: fakeMemberSession(USER, TOKEN) }, error: null },
    rows: ROWS,
    memberToken: TOKEN,
  });
}

describe("member-data queries never run as anonymous", () => {
  for (const [name, factory] of QUERIES) {
    test(`${name}: every read carries her own token`, async () => {
      const fake = setup();
      const client = new QueryClient();
      const options = factory(fake.client as never);
      await client.fetchQuery({ ...(options as object), retry: false } as never);
      expect(fake.requests.length).toBeGreaterThan(0);
      expect(fake.requests.every((r) => r.authorization === `Bearer ${TOKEN}`)).toBe(true);
      expect(options.retry).toBe(memberQueryRetry);
      client.clear();
    });

    test(`${name}: a failing token refresh keeps the cached data instead of an empty anonymous read`, async () => {
      const fake = setup();
      const client = new QueryClient();
      const options = factory(fake.client as never);
      const before = await client.fetchQuery({ ...(options as object), retry: false } as never);
      const sentBefore = fake.requests.length;

      fake.setSession({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      });
      let thrown: unknown = null;
      try {
        await client.fetchQuery({ ...(options as object), retry: false, staleTime: 0 } as never);
      } catch (error) {
        thrown = error;
      }
      expect(isMemberSessionUnavailable(thrown)).toBe(true);
      expect(fake.requests.length).toBe(sentBefore);
      expect(client.getQueryData(options.queryKey as never)).toEqual(before);
      client.clear();
    });
  }
});

describe("memberQueryRetry", () => {
  test("keeps retrying while her session is unavailable, then gives up", () => {
    const error = new (class extends Error {
      name = "MemberSessionUnavailableError";
    })();
    expect(memberQueryRetry(0, error)).toBe(true);
    expect(memberQueryRetry(MEMBER_SESSION_RETRIES - 1, error)).toBe(true);
    expect(memberQueryRetry(MEMBER_SESSION_RETRIES, error)).toBe(false);
  });

  test("any other error keeps React Query's defaults: 3 retries in the browser, none on the server", () => {
    // bun runs without a window: the server default.
    expect(memberQueryRetry(0, new Error("boom"))).toBe(false);
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
    try {
      expect(memberQueryRetry(2, new Error("boom"))).toBe(true);
      expect(memberQueryRetry(3, new Error("boom"))).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, "window");
    }
  });
});
