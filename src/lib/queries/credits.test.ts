import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver, focusManager } from "@tanstack/react-query";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { utcDay } from "@/lib/credits";
import { creditsQueryOptions } from "./credits";
import { fakeMemberSession, fakeSupabase } from "../../../tests/helpers/fake-member-supabase";

const USER = "u1";
const TOKEN = "member-token";

function rows() {
  return {
    // 3 daily credits already reset today + 2 purchased = 5 effective.
    user_entitlements: [{ ai_credits: 3, purchased_credits: 2, credits_reset_at: utcDay() }],
    subscriptions: [],
    subscription_plans: [],
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

async function until(check: () => boolean, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await flush();
}

afterEach(() => {
  focusManager.setFocused(undefined);
});

describe("credits query while her token refresh is failing", () => {
  test("refresh failed, then window focus: credits still show the last value, never 0", async () => {
    const fake = fakeSupabase({
      session: { data: { session: fakeMemberSession(USER, TOKEN) }, error: null },
      rows: rows(),
      memberToken: TOKEN,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } });
    // QueryClientProvider mounts the client in the app; mounting is what
    // subscribes it to window focus.
    client.mount();
    const observer = new QueryObserver(client, creditsQueryOptions(USER, fake.client as never));
    const unsubscribe = observer.subscribe(() => {});
    await until(() => observer.getCurrentResult().status === "success");
    expect(observer.getCurrentResult().data).toBe(5);

    // The access token expired while the tab was hidden and the refresh fails
    // (network still waking, or GoTrue 5xx): getSession() has no session.
    fake.setSession({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    // She comes back to the tab: React Query refetches on focus.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await until(() => observer.getCurrentResult().failureCount > 0);

    const during = observer.getCurrentResult();
    expect(during.data).toBe(5);
    expect(during.isError).toBe(false);
    // Nothing went out as anonymous.
    expect(fake.requests.every((r) => r.authorization === `Bearer ${TOKEN}`)).toBe(true);

    // The refresh lands: the next retry reads her real balance again.
    fake.setRows({
      ...rows(),
      user_entitlements: [{ ai_credits: 3, purchased_credits: 4, credits_reset_at: utcDay() }],
    });
    fake.setSession({ data: { session: fakeMemberSession(USER, TOKEN) }, error: null });
    await until(() => observer.getCurrentResult().data === 7);
    expect(observer.getCurrentResult().data).toBe(7);
    expect(fake.requests.every((r) => r.authorization === `Bearer ${TOKEN}`)).toBe(true);

    unsubscribe();
    client.unmount();
    client.clear();
  });

  test("a read error keeps the last value instead of reporting 0 credits", async () => {
    const fake = fakeSupabase({
      session: { data: { session: fakeMemberSession(USER, TOKEN) }, error: null },
      rows: rows(),
      memberToken: TOKEN,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } });
    const options = creditsQueryOptions(USER, fake.client as never);
    expect(await client.fetchQuery(options)).toBe(5);

    // A different token (expired, or rejected) reaches PostgREST: it answers
    // with an error, which must not become "0 credits".
    const broken = {
      ...fake.client,
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "order", "limit", "maybeSingle", "setHeader"]) {
          chain[m] = () => chain;
        }
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { code: "PGRST303", message: "JWT expired" } }).then(
            resolve,
          );
        return chain;
      },
    };
    await expect(
      client.fetchQuery({
        ...creditsQueryOptions(USER, broken as never),
        retry: false,
        staleTime: 0,
      }),
    ).rejects.toBeTruthy();
    expect(client.getQueryData(options.queryKey)).toBe(5);
    client.clear();
  });
});
