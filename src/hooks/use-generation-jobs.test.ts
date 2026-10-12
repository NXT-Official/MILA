import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import {
  createJobsAvailability,
  generationJobKeys,
  generationMutationKey,
  generationMutationOptions,
  jobJustSettled,
  latestGenerationJobQueryOptions,
  parseGenerationJobRow,
  pendingGenerationFilters,
  pendingGenerationOf,
} from "@/lib/queries/generation-jobs";
import { fakeMemberSession } from "../../tests/helpers/fake-member-supabase";
import { fakeGenerationJobsClient } from "../../tests/helpers/fake-generation-jobs-supabase";

/**
 * The dashboard's generation hooks are thin wrappers over TanStack Query
 * observers (useMutation = MutationObserver, useMutationState = the mutation
 * cache, useQuery = QueryObserver). There is no DOM under bun:test, so these
 * drive the same observers with the same options the hooks pass, against a
 * fake Supabase, the way src/lib/queries/credits.test.ts does.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const TOKEN = "member-token";

type Vars = { userId: string; clientRequestId: string; run: number };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(check: () => boolean, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await flush();
}

function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    user_id: USER,
    kind: "look",
    client_request_id: "22222222-2222-4222-8222-222222222222",
    status: "running",
    credit_state: "charged",
    result: null,
    image_path: null,
    error_code: null,
    input: {},
    deadline_at: new Date(Date.now() + 300_000).toISOString(),
    created_at: new Date(Date.now() - 5_000).toISOString(),
    completed_at: null,
    ...overrides,
  };
}

describe("a generation call outlives the page that started it", () => {
  test("leaving mid-run: the call stays pending under its key, and the next mount finds it", async () => {
    const client = new QueryClient();
    const server = deferred<{ headline: string }>();
    const calls: Vars[] = [];
    const options = generationMutationOptions<Vars, { headline: string }>(
      "look",
      async (vars) => {
        calls.push(vars);
        return server.promise;
      },
      client,
    );

    // First visit to the dashboard: press Create.
    const firstMount = new MutationObserver(client, options);
    const unsubscribe = firstMount.subscribe(() => {});
    const press = firstMount.mutate({ userId: USER, clientRequestId: "req-1", run: 1 });
    // Pending in the cache the moment it is pressed: a second press in the
    // same tick already sees it (the dashboard's double-press guard).
    expect(client.isMutating({ mutationKey: generationMutationKey("look") })).toBe(1);
    await flush();
    // She leaves the page mid-run.
    unsubscribe();

    // She comes back: a fresh mount reads the mutation cache by key.
    const pending = client
      .getMutationCache()
      .findAll(pendingGenerationFilters("look"))
      .map(pendingGenerationOf<Vars>);
    expect(pending).toHaveLength(1);
    expect(pending[0].variables?.clientRequestId).toBe("req-1");
    expect(pending[0].submittedAt).toBeGreaterThan(0);
    expect(client.isMutating({ mutationKey: generationMutationKey("look") })).toBe(1);
    // Nothing was sent again.
    expect(calls).toHaveLength(1);

    server.resolve({ headline: "Linen" });
    await expect(press).resolves.toEqual({ headline: "Linen" });
    expect(client.isMutating({ mutationKey: generationMutationKey("look") })).toBe(0);
    client.clear();
  });

  test("its hook-level onSettled still refreshes her credits and job rows after she left", async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.credits(USER), 5);
    client.setQueryData(generationJobKeys.latest(USER, "look"), { status: "ready", job: null });
    const server = deferred<string>();
    const observer = new MutationObserver(
      client,
      generationMutationOptions<Vars, string>("look", () => server.promise, client),
    );
    const unsubscribe = observer.subscribe(() => {});
    const press = observer.mutate({ userId: USER, clientRequestId: "req-1", run: 1 });
    unsubscribe();

    server.resolve("done");
    await press;
    await flush();
    expect(client.getQueryState(queryKeys.credits(USER))?.isInvalidated).toBe(true);
    expect(client.getQueryState(generationJobKeys.latest(USER, "look"))?.isInvalidated).toBe(true);
    client.clear();
  });

  test("a failed call is never retried on its own: a retry is a new press with the same id", async () => {
    const client = new QueryClient();
    let attempts = 0;
    const observer = new MutationObserver(
      client,
      generationMutationOptions<Vars, string>(
        "style_sheet",
        async () => {
          attempts += 1;
          throw new TypeError("Failed to fetch");
        },
        client,
      ),
    );
    await observer.mutate({ userId: USER, clientRequestId: "req-1", run: 1 }).catch(() => {});
    expect(attempts).toBe(1);
    client.clear();
  });

  test("each kind has its own key, so a portrait in flight never reads as a look in flight", async () => {
    const client = new QueryClient();
    const server = deferred<string>();
    const portrait = new MutationObserver(
      client,
      generationMutationOptions<Vars, string>("photo_preview", () => server.promise, client),
    );
    const press = portrait.mutate({ userId: USER, clientRequestId: "req-1", run: 1 });
    expect(client.getMutationCache().findAll(pendingGenerationFilters("look"))).toHaveLength(0);
    expect(
      client.getMutationCache().findAll(pendingGenerationFilters("photo_preview")),
    ).toHaveLength(1);
    server.resolve("ok");
    await press;
    client.clear();
  });
});

describe("following her job row (useLatestGenerationJob)", () => {
  test("a reload mid-run finds the running row, then the finished one, from the fake database", async () => {
    const fake = fakeGenerationJobsClient({
      session: fakeMemberSession(USER, TOKEN),
      rows: [rawRow()],
    });
    const client = new QueryClient();
    const observer = new QueryObserver(
      client,
      latestGenerationJobQueryOptions(USER, "look", {
        client: fake.client as never,
        availability: createJobsAvailability(),
      }),
    );
    const unsubscribe = observer.subscribe(() => {});
    await until(() => observer.getCurrentResult().status === "success");
    expect(observer.getCurrentResult().data).toMatchObject({ job: { status: "running" } });

    fake.setRows([
      rawRow({
        status: "succeeded",
        result: { outfit: { headline: "Linen" } },
        completed_at: new Date().toISOString(),
      }),
    ]);
    await observer.refetch();
    expect(observer.getCurrentResult().data).toMatchObject({ job: { status: "succeeded" } });
    unsubscribe();
    client.clear();
  });

  test("a row that stops running is the moment to refresh her credits (a refund may have landed)", () => {
    const running = parseGenerationJobRow(rawRow());
    const failed = parseGenerationJobRow(
      rawRow({
        status: "failed",
        credit_state: "refunded",
        completed_at: new Date().toISOString(),
      }),
    );
    const otherRunning = parseGenerationJobRow(rawRow({ id: "job-2" }));
    expect(jobJustSettled(running, failed)).toBe(true);
    expect(jobJustSettled(running, running)).toBe(false);
    expect(jobJustSettled(null, failed)).toBe(false);
    expect(jobJustSettled(running, otherRunning)).toBe(false);
    expect(jobJustSettled(running, null)).toBe(false);
  });
});

// The hooks need a DOM to mount, which bun:test does not have; these pin the
// wiring by reading the source (as src/routes/_authenticated/_app/dashboard.test.ts does).
const hooksSource = readFileSync(new URL("./use-generation-jobs.ts", import.meta.url), "utf8");

/** The text of one exported hook, up to the next export. */
function hook(name: string) {
  const start = hooksSource.indexOf(`export function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = hooksSource.indexOf("\nexport function ", start + 1);
  return hooksSource.slice(start, next === -1 ? hooksSource.length : next);
}

describe("a tab left open (NEW-I1)", () => {
  test("useNow re-reads the time whenever she comes back, running or not", () => {
    const body = hook("useNow");
    expect(body).toContain("onPageReturn(");
    // That listener is not gated on `active`: it has its own effect.
    const listener = body.slice(body.lastIndexOf("useEffect(", body.indexOf("onPageReturn(")));
    expect(listener).not.toContain("if (!active) return;");
  });
});

describe("the reaper's count is kept per job for the tab, not per visit to the page", () => {
  test("every mount shares the session-stored memory", () => {
    expect(hook("useStaleGenerationReaper")).toContain("memory: generationReaps");
  });
});

describe("the reaper is handed every row she is shown (round 4)", () => {
  test("including her own job behind a newer row", () => {
    expect(hook("useReapStaleJobs")).toMatch(/const \[first, second, third, fourth\] = jobs;/);
  });
});
