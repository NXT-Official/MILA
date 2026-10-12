import { describe, expect, mock, spyOn, test } from "bun:test";
import { InsufficientCreditsError } from "./credits";
import { DomainValidationError } from "@/server/http/api-errors";
import type { Json } from "@/integrations/supabase/types";
import {
  DELIVERED_NOT_SAVED,
  DELIVERED_NOT_SAVED_MESSAGE,
  isDeliveredNotSaved,
} from "./generation-error-codes";
import { photoPreviewJob, type PhotoPreviewResult } from "@/server/services/photo-preview";
import { styleSheetJob, type StyleSheetPreviewResult } from "@/server/services/style-sheet";
import {
  GenerationDeliveredUnsavedError,
  GenerationImageExistsError,
  GenerationInFlightError,
  GenerationJobStoreError,
  GenerationJobsUnavailableError,
  MAX_JOB_RESULT_CHARS,
  reapGenerationJobs,
  resolveDailyAllowance,
  toGenerationJobStoreError,
  withJobId,
  createAvailabilityCache,
  dataUriToImage,
  stableJson,
  toJsonbSafe,
  withGenerationJob,
  type GenerationJobDeps,
  type GenerationJobSpec,
} from "./generation-jobs.server";
import { MemoryGenerationJobStore } from "../../tests/helpers/memory-generation-job-store";

const USER = "user-1";
const REQ_A = "00000000-0000-4000-8000-00000000000a";
const REQ_B = "00000000-0000-4000-8000-00000000000b";
const JPEG_DATA_URI = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")}`;

type Look = { headline: string; jobId?: string };
type Render = { imageDataUri: string | null; mode: "render" | "unavailable"; reason?: string };

function setup(daily = 1, purchased = 0) {
  const store = new MemoryGenerationJobStore();
  store.seed(USER, daily, purchased);
  const deps: GenerationJobDeps = {
    store,
    availability: createAvailabilityCache(60_000),
    sleep: () => new Promise((resolve) => setTimeout(resolve, 1)),
    pollMs: 1,
    persistReserveMs: 0,
  };
  return { store, deps };
}

function lookSpec(overrides: Partial<GenerationJobSpec<Look>> = {}): GenerationJobSpec<Look> {
  return {
    kind: "look",
    userId: USER,
    clientRequestId: REQ_A,
    input: { vibe: "Work" },
    charge: true,
    dailyAllowance: 1,
    deadlineSeconds: 30,
    settle: (look) => ({ ok: true, result: { headline: look.headline } }),
    fromStored: ({ result }) => ({ headline: (result as { headline: string }).headline }),
    failure: (code) => {
      throw new Error(`failed:${code}`);
    },
    legacy: async () => ({ headline: "legacy" }),
    ...overrides,
  };
}

function renderSpec(overrides: Partial<GenerationJobSpec<Render>> = {}): GenerationJobSpec<Render> {
  return {
    kind: "style_sheet",
    userId: USER,
    clientRequestId: REQ_A,
    input: { headline: "H" },
    charge: true,
    dailyAllowance: 1,
    deadlineSeconds: 30,
    settle: (render) =>
      render.imageDataUri
        ? { ok: true, result: { mode: "render" }, imageDataUri: render.imageDataUri }
        : { ok: false, errorCode: "unavailable" },
    fromStored: ({ imageDataUri }) => ({ imageDataUri, mode: "render" }),
    failure: (code) => ({ imageDataUri: null, mode: "unavailable", reason: code }),
    legacy: async () => ({ imageDataUri: null, mode: "unavailable", reason: "legacy" }),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("withGenerationJob: success and idempotency", () => {
  test("charges one credit, persists the result before answering, and returns the job id", async () => {
    const { store, deps } = setup();
    const out = await withGenerationJob(lookSpec(), async () => ({ headline: "Linen day" }), deps);

    expect(out.status).toBe("done");
    if (out.status !== "done") return;
    expect(out.value).toEqual({ headline: "Linen day" });
    expect(out.jobId).toBe(store.rows[0].id);
    expect(store.rows[0].status).toBe("succeeded");
    expect(store.rows[0].result).toEqual({ headline: "Linen day" });
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 0 });
  });

  test("the same request id twice charges once and replays the stored result", async () => {
    const { store, deps } = setup(5);
    const produce = mock(async () => ({ headline: "Linen day" }));

    const first = await withGenerationJob(lookSpec(), produce, deps);
    const second = await withGenerationJob(lookSpec(), produce, deps);

    expect(produce).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ ...first, replayed: true } as typeof second);
    expect(store.balance(USER).daily).toBe(4);
    expect(store.rows).toHaveLength(1);
  });

  test("the same request id while the first is still running answers 'running' without a second charge", async () => {
    const { store, deps } = setup(5);
    const gate = deferred<Look>();
    const produce = mock(() => gate.promise);

    const first = withGenerationJob(lookSpec({ inFlight: "report" }), produce, deps);
    await new Promise((r) => setTimeout(r, 5));
    const second = await withGenerationJob(lookSpec({ inFlight: "report" }), produce, deps);

    expect(second).toEqual({ status: "running", jobId: store.rows[0].id });
    gate.resolve({ headline: "Linen day" });
    expect((await first).status).toBe("done");
    expect(produce).toHaveBeenCalledTimes(1);
    expect(store.balance(USER).daily).toBe(4);
  });

  test("a caller without a request id attaches to the in-flight job and gets its result, charged once", async () => {
    const { store, deps } = setup(5);
    const gate = deferred<Look>();
    const produce = mock(() => gate.promise);

    const first = withGenerationJob(lookSpec({ clientRequestId: REQ_A }), produce, deps);
    await new Promise((r) => setTimeout(r, 5));
    const attached = withGenerationJob(lookSpec({ clientRequestId: undefined }), produce, deps);
    setTimeout(() => gate.resolve({ headline: "Linen day" }), 10);

    const [a, b] = await Promise.all([first, attached]);
    expect(a.status).toBe("done");
    expect(b).toEqual({
      status: "done",
      jobId: store.rows[0].id,
      value: { headline: "Linen day" },
      replayed: true,
    });
    expect(produce).toHaveBeenCalledTimes(1);
    expect(store.balance(USER).daily).toBe(4);
  });

  test("an attached caller whose job outlives the wait gets a retry-later error, never a charge", async () => {
    const { store, deps } = setup(5);
    const produce = mock(() => new Promise<Look>(() => {}));

    const first = withGenerationJob(lookSpec({ deadlineSeconds: 1 }), produce, deps);
    await new Promise((r) => setTimeout(r, 5));
    const attached = withGenerationJob(
      lookSpec({ clientRequestId: REQ_B, deadlineSeconds: 1 }),
      produce,
      { ...deps, maxAttachMs: 20 },
    );

    await expect(attached).rejects.toBeInstanceOf(GenerationInFlightError);
    expect(store.balance(USER).daily).toBe(4);
    expect(produce).toHaveBeenCalledTimes(1);

    // The hung first job still hits its own deadline and refunds.
    await expect(first).rejects.toThrow("failed:deadline_exceeded");
    expect(store.balance(USER).daily).toBe(5);
  });
});

describe("withGenerationJob: refunds", () => {
  test("a throwing produce refunds exactly once, back to the daily bucket, and rethrows the same error", async () => {
    const { store, deps } = setup(1, 3);
    const boom = new Error("provider down");

    await expect(
      withGenerationJob(
        lookSpec(),
        async () => {
          throw boom;
        },
        deps,
      ),
    ).rejects.toBe(boom);

    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER)).toEqual({ daily: 1, purchased: 3 });
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].credit_state).toBe("refunded");
  });

  test("a credit charged from the purchased bucket goes back to purchased", async () => {
    const { store, deps } = setup(0, 2);
    await expect(
      withGenerationJob(
        lookSpec(),
        async () => {
          throw new Error("x");
        },
        deps,
      ),
    ).rejects.toThrow("x");
    expect(store.rows[0].charged_from).toBe("purchased");
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 2 });
  });

  test("an 'unavailable' result refunds once and is answered as today", async () => {
    const { store, deps } = setup();
    const unavailable: Render = { imageDataUri: null, mode: "unavailable", reason: "QA said no" };

    const out = await withGenerationJob(renderSpec(), async () => unavailable, deps);

    expect(out).toEqual({
      status: "done",
      jobId: store.rows[0].id,
      value: unavailable,
      replayed: false,
    });
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].error_code).toBe("unavailable");
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER).daily).toBe(1);
  });

  test("a produce that hangs past the deadline fails the job, refunds once, and answers the failure", async () => {
    const { store, deps } = setup();
    const out = await withGenerationJob(
      renderSpec({ deadlineSeconds: 0.03 }),
      () => new Promise<Render>(() => {}),
      deps,
    );

    expect(out.status).toBe("done");
    if (out.status !== "done") return;
    expect(out.value).toEqual({
      imageDataUri: null,
      mode: "unavailable",
      reason: "deadline_exceeded",
    });
    expect(store.rows[0].status).toBe("failed");
    expect(store.calls.refunds).toBe(1);
  });

  test("a result that lands after the deadline is not stored and never refunds twice", async () => {
    const { store, deps } = setup();
    const out = await withGenerationJob(
      renderSpec({ deadlineSeconds: 0.02 }),
      () =>
        new Promise<Render>((resolve) =>
          setTimeout(() => resolve({ imageDataUri: JPEG_DATA_URI, mode: "render" }), 60),
        ),
      deps,
    );
    await new Promise((r) => setTimeout(r, 90));

    expect(out.status).toBe("done");
    expect(store.rows[0].status).toBe("failed");
    expect(store.calls.complete).toBe(0);
    expect(store.calls.uploads).toBe(0);
    expect(store.calls.refunds).toBe(1);
  });

  test("an upload that keeps failing: the render is delivered and the charge is kept", async () => {
    const { store, deps } = setup();
    store.failUpload = true;

    const out = await withGenerationJob(
      renderSpec(),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );

    // Not stored, so no job id to follow: the in-hand render is the answer.
    expect(out).toEqual({
      status: "done",
      jobId: null,
      value: { imageDataUri: JPEG_DATA_URI, mode: "render" },
      replayed: false,
    });
    expect(store.calls.uploads).toBe(2); // one retry
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].error_code).toBe("persist_failed_delivered");
    expect(store.rows[0].credit_state).toBe("charged");
    expect(store.calls.refunds).toBe(0);
    expect(store.balance(USER).daily).toBe(0);
  });

  test("a complete write that keeps failing: the look is delivered and the charge is kept", async () => {
    const { store, deps } = setup();
    store.failComplete = true;

    const out = await withGenerationJob(lookSpec(), async () => ({ headline: "Linen day" }), deps);

    expect(out).toEqual({
      status: "done",
      jobId: null,
      value: { headline: "Linen day" },
      replayed: false,
    });
    expect(store.calls.complete).toBe(2); // one retry
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].error_code).toBe("persist_failed_delivered");
    expect(store.calls.refunds).toBe(0);
  });

  test("a complete that committed but lost its answer still hands her the paid result", async () => {
    const { store, deps } = setup();
    store.loseCompleteAnswer = true;

    const out = await withGenerationJob(lookSpec(), async () => ({ headline: "Linen day" }), deps);

    expect(out.status === "done" && out.value).toEqual({ headline: "Linen day" });
    expect(store.rows[0].status).toBe("succeeded");
    expect(store.calls.refunds).toBe(0);
  });

  test("a replayed failed job answers the failure without charging again", async () => {
    const { store, deps } = setup(5);
    await withGenerationJob(
      renderSpec(),
      async () => ({ imageDataUri: null, mode: "unavailable" as const }),
      deps,
    );
    const produce = mock(async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }));

    const again = await withGenerationJob(renderSpec(), produce, deps);

    expect(produce).not.toHaveBeenCalled();
    expect(again.status).toBe("done");
    if (again.status !== "done") return;
    expect(again.value).toEqual({ imageDataUri: null, mode: "unavailable", reason: "unavailable" });
    expect(store.balance(USER).daily).toBe(5);
  });

  test("dead jobs are reaped in their own call, so an insufficient-credits raise cannot undo it", async () => {
    let clock = 1_000_000;
    const store = new MemoryGenerationJobStore(() => clock);
    store.seed(USER, 0, 0);
    // A free job whose server was killed: running forever unless reaped.
    await store.start({
      userId: USER,
      kind: "look",
      clientRequestId: REQ_B,
      input: {},
      charge: false,
      dailyAllowance: 0,
      deadlineSeconds: 10,
    });
    clock += 41_000; // past deadline + the reaper's 30 s grace

    await expect(
      withGenerationJob(lookSpec(), async () => ({ headline: "Linen day" }), {
        store,
        availability: createAvailabilityCache(60_000),
        persistReserveMs: 0,
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    // start's own reap was rolled back with its raise; the separate call stuck.
    const dead = store.rows.find((r) => r.client_request_id === REQ_B);
    expect(dead?.status).toBe("failed");
    expect(dead?.error_code).toBe("deadline_exceeded");
  });

  test("insufficient credits surfaces the existing error and never runs the work", async () => {
    const { deps } = setup(0, 0);
    const produce = mock(async () => ({ headline: "x" }));
    await expect(withGenerationJob(lookSpec(), produce, deps)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(produce).not.toHaveBeenCalled();
  });
});

describe("withGenerationJob: images", () => {
  test("uploads the render to <uid>/<jobId>.jpg and stores only the path", async () => {
    const { store, deps } = setup();
    const out = await withGenerationJob(
      renderSpec(),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );

    const row = store.rows[0];
    expect(row.image_path).toBe(`${USER}/${row.id}.jpg`);
    expect(store.images.get(`${USER}/${row.id}.jpg`)?.contentType).toBe("image/jpeg");
    expect(JSON.stringify(row.result)).not.toContain("data:");
    expect(out).toEqual({
      status: "done",
      jobId: row.id,
      value: { imageDataUri: JPEG_DATA_URI, mode: "render" },
      replayed: false,
    });
  });

  test("a replay reads the stored image back as the same data URI", async () => {
    const { deps } = setup(5);
    const produce = mock(async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }));
    await withGenerationJob(renderSpec(), produce, deps);

    const replay = await withGenerationJob(renderSpec(), produce, deps);

    expect(produce).toHaveBeenCalledTimes(1);
    expect(replay.status).toBe("done");
    if (replay.status !== "done") return;
    expect(replay.value).toEqual({ imageDataUri: JPEG_DATA_URI, mode: "render" });
  });

  test("a settle that tries to store a data URI in the result is refused, never stored", async () => {
    const { store, deps } = setup();
    const out = await withGenerationJob(
      renderSpec({
        settle: (r) => ({ ok: true, result: { image: r.imageDataUri } }),
      }),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );
    expect(out.status).toBe("done");
    if (out.status !== "done") return;
    expect(out.jobId).toBeNull();
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].error_code).toBe("persist_failed_delivered");
    expect(store.rows[0].result).toBeNull();
    expect(store.calls.uploads).toBe(0);
    expect(store.calls.refunds).toBe(0);
  });

  test("dataUriToImage decodes jpeg/png/webp and rejects anything else", () => {
    expect(dataUriToImage(JPEG_DATA_URI)).toEqual({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      contentType: "image/jpeg",
      extension: "jpg",
    });
    expect(dataUriToImage("data:image/png;base64,AAAA")?.extension).toBe("png");
    expect(dataUriToImage("https://example.com/a.jpg")).toBeNull();
    expect(dataUriToImage("data:text/html;base64,AAAA")).toBeNull();
  });
});

describe("withGenerationJob: free render slot", () => {
  test("a claimed free slot starts the job without a charge and is released once on failure", async () => {
    const { store, deps } = setup(1);
    const release = mock(async () => {});
    const out = await withGenerationJob(
      renderSpec({ freeSlot: { claim: async () => true, release } }),
      async () => ({ imageDataUri: null, mode: "unavailable" as const }),
      deps,
    );

    expect(out.status).toBe("done");
    expect(store.rows[0].credit_state).toBe("none");
    expect(store.balance(USER).daily).toBe(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(store.calls.refunds).toBe(0);
  });

  test("no free slot: one credit is charged and refunded on failure, the slot is untouched", async () => {
    const { store, deps } = setup(1);
    const release = mock(async () => {});
    await withGenerationJob(
      renderSpec({ freeSlot: { claim: async () => false, release } }),
      async () => ({ imageDataUri: null, mode: "unavailable" as const }),
      deps,
    );
    expect(store.rows[0].credit_state).toBe("refunded");
    expect(release).not.toHaveBeenCalled();
  });

  test("a claimed slot is handed back when the request only finds an in-flight job", async () => {
    const { deps } = setup(5);
    const gate = deferred<Render>();
    void withGenerationJob(renderSpec({ inFlight: "report" }), () => gate.promise, deps);
    await new Promise((r) => setTimeout(r, 5));
    const release = mock(async () => {});

    const out = await withGenerationJob(
      renderSpec({
        clientRequestId: REQ_B,
        inFlight: "report",
        freeSlot: { claim: async () => true, release },
      }),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );

    expect(out.status).toBe("running");
    expect(release).toHaveBeenCalledTimes(1);
    gate.resolve({ imageDataUri: JPEG_DATA_URI, mode: "render" });
  });

  test("a successful free render keeps the slot spent", async () => {
    const { deps } = setup(1);
    const release = mock(async () => {});
    await withGenerationJob(
      renderSpec({ freeSlot: { claim: async () => true, release } }),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );
    expect(release).not.toHaveBeenCalled();
  });
});

describe("withGenerationJob: migration not applied", () => {
  test("falls back to the legacy path, never runs produce, and remembers the miss", async () => {
    const { store, deps } = setup();
    store.missing = true;
    const legacy = mock(async () => ({ headline: "legacy" }));
    const produce = mock(async () => ({ headline: "new" }));

    const first = await withGenerationJob(lookSpec({ legacy }), produce, deps);
    const callsAfterFirst = { ...store.calls };
    const second = await withGenerationJob(
      lookSpec({ legacy, clientRequestId: REQ_B }),
      produce,
      deps,
    );

    expect(first).toEqual({
      status: "done",
      jobId: null,
      value: { headline: "legacy" },
      replayed: false,
    });
    expect(second.status).toBe("done");
    expect(legacy).toHaveBeenCalledTimes(2);
    expect(produce).not.toHaveBeenCalled();
    expect(store.calls).toEqual(callsAfterFirst);
  });

  test("a missing migration is found before the free slot is claimed, so the legacy path owns it", async () => {
    const { store, deps } = setup();
    store.missing = true;
    const release = mock(async () => {});
    const claim = mock(async () => true);
    const legacy = mock(async () => ({ imageDataUri: null, mode: "unavailable" as const }));

    await withGenerationJob(
      renderSpec({ clientRequestId: undefined, freeSlot: { claim, release }, legacy }),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );

    expect(claim).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  test("the miss is re-checked once the cache window passes", async () => {
    let now = 1_000;
    const cache = createAvailabilityCache(1_000, () => now);
    const { store, deps } = setup();
    store.missing = true;
    const legacy = mock(async () => ({ headline: "legacy" }));

    await withGenerationJob(lookSpec({ legacy }), async () => ({ headline: "x" }), {
      ...deps,
      availability: cache,
    });
    store.missing = false;
    now += 1_001;
    const out = await withGenerationJob(
      lookSpec({ legacy, clientRequestId: REQ_B }),
      async () => ({ headline: "new" }),
      { ...deps, availability: cache },
    );

    expect(out.status === "done" && out.value).toEqual({ headline: "new" });
  });
});

describe("generation job helpers", () => {
  test("reapGenerationJobs reports the count, or available:false before the migration", async () => {
    let clock = 1_000_000;
    const store = new MemoryGenerationJobStore(() => clock);
    store.seed(USER, 1);
    await store.start({
      userId: USER,
      kind: "style_sheet",
      clientRequestId: REQ_A,
      input: {},
      charge: true,
      dailyAllowance: 1,
      deadlineSeconds: 10,
    });
    clock += 41_000;

    expect(await reapGenerationJobs(USER, store)).toEqual({ available: true, reaped: 1 });
    expect(store.balance(USER).daily).toBe(1);

    store.missing = true;
    expect(await reapGenerationJobs(null, store)).toEqual({ available: false, reaped: 0 });
  });

  test("store errors map to the existing errors and never leak raw database text", () => {
    expect(toGenerationJobStoreError("x", { code: "PGRST202" })).toBeInstanceOf(
      GenerationJobsUnavailableError,
    );
    expect(toGenerationJobStoreError("x", { code: "PGRST205" })).toBeInstanceOf(
      GenerationJobsUnavailableError,
    );
    expect(toGenerationJobStoreError("x", { code: "42P01" })).toBeInstanceOf(
      GenerationJobsUnavailableError,
    );
    expect(toGenerationJobStoreError("x", { code: "42883" })).toBeInstanceOf(
      GenerationJobsUnavailableError,
    );
    expect(
      toGenerationJobStoreError("x", { code: "P0001", message: "insufficient_credits" }),
    ).toBeInstanceOf(InsufficientCreditsError);
    expect(
      toGenerationJobStoreError("x", { code: "P0001", message: "client_request_id_conflict" }),
    ).toBeInstanceOf(DomainValidationError);

    const other = toGenerationJobStoreError("x", {
      code: "P0001",
      message: "entitlements_not_found",
    });
    expect(other).toBeInstanceOf(GenerationJobStoreError);
    expect(other.message).not.toContain("entitlements");
  });

  test("resolveDailyAllowance reads the plan's allowance without writing a credit", async () => {
    const supabase = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({
            data:
              table === "subscriptions"
                ? {
                    plan_id: "plan-1",
                    status: "active",
                    current_period_end: "2999-01-01T00:00:00Z",
                    cancel_at_period_end: false,
                  }
                : { credits_included: 7 },
            error: null,
          }),
          update: () => {
            throw new Error("resolveDailyAllowance must not write");
          },
        };
        return chain;
      },
      rpc: () => {
        throw new Error("resolveDailyAllowance must not call a credit RPC");
      },
    } as unknown as Parameters<typeof resolveDailyAllowance>[0];

    expect(await resolveDailyAllowance(supabase, USER)).toBe(7);
  });

  test("withJobId adds the id only when a job exists", () => {
    expect(withJobId({ a: 1 }, "job-1")).toEqual({ a: 1, jobId: "job-1" });
    expect(withJobId({ a: 1 }, null)).toEqual({ a: 1 });
  });

  test("the in-flight error is a RATE_LIMITED error with calm copy and no dashes", () => {
    const err = new GenerationInFlightError(30);
    expect(err.retryAfterSeconds).toBe(30);
    expect(err.message).toBe("Mila is still finishing your last request. Try again in a moment.");
    expect(err.message).not.toMatch(/[—–]/);
  });

  test("a job that settles while the attached caller waits is answered from its row", async () => {
    const { store, deps } = setup(5);
    const gate = deferred<Render>();
    const first = withGenerationJob(renderSpec(), () => gate.promise, deps);
    await new Promise((r) => setTimeout(r, 5));
    const attached = withGenerationJob(
      renderSpec({ clientRequestId: null }),
      async () => {
        throw new Error("must not run");
      },
      deps,
    );
    setTimeout(() => gate.resolve({ imageDataUri: null, mode: "unavailable", reason: "x" }), 10);

    const [, b] = await Promise.all([first, attached]);
    expect(b.status === "done" && b.value).toEqual({
      imageDataUri: null,
      mode: "unavailable",
      reason: "unavailable",
    });
    expect(store.calls.refunds).toBe(1);
  });
});

describe("review round 1", () => {
  test("I1: a request with DIFFERENT input never receives another request's result", async () => {
    const { store, deps } = setup(5);
    const gate = deferred<Look>();
    const first = withGenerationJob(
      lookSpec({ input: { vibe: "Work" } }),
      () => gate.promise,
      deps,
    );
    await new Promise((r) => setTimeout(r, 5));
    const produce = mock(async () => ({ headline: "Date night" }));

    const second = withGenerationJob(
      lookSpec({ clientRequestId: undefined, input: { vibe: "Date night" } }),
      produce,
      deps,
    );
    // Asked for "Date night" while "Work" composes: a calm retry-later, never "Work".
    await expect(second).rejects.toBeInstanceOf(GenerationInFlightError);
    expect(produce).not.toHaveBeenCalled();

    gate.resolve({ headline: "Work" });
    expect((await first).status).toBe("done");
    expect(store.balance(USER).daily).toBe(4);
  });

  test("I1: a 'report' caller with different input is not told someone else's job is its own", async () => {
    const { deps } = setup(5);
    const gate = deferred<Look>();
    const first = withGenerationJob(
      lookSpec({ input: { vibe: "Work" } }),
      () => gate.promise,
      deps,
    );
    await new Promise((r) => setTimeout(r, 5));

    await expect(
      withGenerationJob(
        lookSpec({ clientRequestId: REQ_B, inFlight: "report", input: { vibe: "Date night" } }),
        async () => ({ headline: "Date night" }),
        deps,
      ),
    ).rejects.toBeInstanceOf(GenerationInFlightError);

    gate.resolve({ headline: "Work" });
    await first;
  });

  test("I1: the same input in a different key order still attaches (jsonb reorders keys)", async () => {
    const { store, deps } = setup(5);
    const gate = deferred<Look>();
    const first = withGenerationJob(
      lookSpec({ input: { vibe: "Work", agenda: { a: 1, b: [1, { y: 2, x: 1 }] } } }),
      () => gate.promise,
      deps,
    );
    await new Promise((r) => setTimeout(r, 5));
    const attached = withGenerationJob(
      lookSpec({
        clientRequestId: undefined,
        input: { agenda: { b: [1, { x: 1, y: 2 }], a: 1 }, vibe: "Work" },
      }),
      async () => ({ headline: "must not run" }),
      deps,
    );
    setTimeout(() => gate.resolve({ headline: "Linen day" }), 10);

    const [, b] = await Promise.all([first, attached]);
    expect(b.status === "done" && b.value).toEqual({ headline: "Linen day" });
    expect(store.balance(USER).daily).toBe(4);
  });

  test("M4: behind a killed job, an attached caller waits for the reaper, reaps it and answers its failure", async () => {
    let clock = 1_000_000;
    const store = new MemoryGenerationJobStore(() => clock);
    store.seed(USER, 5);
    await store.start({
      userId: USER,
      kind: "style_sheet",
      clientRequestId: REQ_B,
      input: { headline: "H" },
      charge: true,
      dailyAllowance: 1,
      deadlineSeconds: 300,
    });
    clock += 300_000 + 10_000; // 10 s past its deadline; the reaper needs 30 s

    const out = await withGenerationJob(
      renderSpec({ clientRequestId: undefined }),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      {
        store,
        availability: createAvailabilityCache(60_000),
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );

    expect(out.status === "done" && out.value).toEqual({
      imageDataUri: null,
      mode: "unavailable",
      reason: "deadline_exceeded",
    });
    expect(store.rows[0].status).toBe("failed");
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER).daily).toBe(5);
  });

  test("M4: a wait cut short behind a killed job says when the reaper can act, not '1 second'", async () => {
    let clock = 1_000_000;
    const store = new MemoryGenerationJobStore(() => clock);
    store.seed(USER, 5);
    await store.start({
      userId: USER,
      kind: "look",
      clientRequestId: REQ_B,
      input: { vibe: "Work" },
      charge: true,
      dailyAllowance: 1,
      deadlineSeconds: 300,
    });
    clock += 300_000 + 10_000;

    const err = await withGenerationJob(
      lookSpec({ clientRequestId: undefined }),
      async () => ({ headline: "x" }),
      {
        store,
        availability: createAvailabilityCache(60_000),
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
        maxAttachMs: 4_000,
      },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GenerationInFlightError);
    expect((err as GenerationInFlightError).retryAfterSeconds).toBe(16);
    expect(store.calls.get).toBeGreaterThan(0);
  });

  test("M4: one failed poll does not abort the wait", async () => {
    const { store, deps } = setup(5);
    const gate = deferred<Look>();
    const first = withGenerationJob(lookSpec(), () => gate.promise, deps);
    await new Promise((r) => setTimeout(r, 5));
    const realGet = store.get.bind(store);
    let failures = 0;
    store.get = async (jobId: string) => {
      if (failures === 0) {
        failures += 1;
        throw new Error("network blip");
      }
      return realGet(jobId);
    };

    const attached = withGenerationJob(
      lookSpec({ clientRequestId: undefined }),
      async () => ({ headline: "x" }),
      deps,
    );
    setTimeout(() => gate.resolve({ headline: "Linen day" }), 10);

    const [, b] = await Promise.all([first, attached]);
    expect(failures).toBe(1);
    expect(b.status === "done" && b.value).toEqual({ headline: "Linen day" });
  });

  test("M3: falling back to the legacy path is reported once per cache window, never silent", async () => {
    const { store, deps } = setup();
    store.missing = true;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withGenerationJob(lookSpec(), async () => ({ headline: "x" }), deps);
      await withGenerationJob(
        lookSpec({ clientRequestId: REQ_B }),
        async () => ({ headline: "x" }),
        deps,
      );
      const reports = warn.mock.calls.filter((args) =>
        String(args[0]).includes("generation jobs unavailable"),
      );
      expect(reports).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("M1: a free job reaped under this request still gets its free slot back", async () => {
    let clock = 1_000_000;
    const store = new MemoryGenerationJobStore(() => clock);
    store.seed(USER, 0);
    const release = mock(async () => {});

    await expect(
      withGenerationJob(
        renderSpec({ deadlineSeconds: 1, freeSlot: { claim: async () => true, release } }),
        async () => {
          // Another request's start reaps this job while it is still producing.
          clock += 40_000;
          await store.reap(USER);
          throw new Error("provider down");
        },
        {
          store,
          availability: createAvailabilityCache(60_000),
          now: () => clock,
          persistReserveMs: 0,
        },
      ),
    ).rejects.toThrow("provider down");

    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].credit_state).toBe("none");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("memory store mirrors the SQL guards", () => {
  test("complete refuses an image path outside the member's folder", async () => {
    const store = new MemoryGenerationJobStore();
    store.seed(USER, 1);
    const { job } = await store.start({
      userId: USER,
      kind: "style_sheet",
      clientRequestId: REQ_A,
      input: {},
      charge: true,
      dailyAllowance: 1,
      deadlineSeconds: 30,
    });
    await expect(store.complete(job.id, {}, "someone-else/x.jpg")).rejects.toThrow(
      "invalid_image_path",
    );
    await expect(store.complete(job.id, {}, `${USER}/../x.jpg`)).rejects.toThrow(
      "invalid_image_path",
    );
  });

  test("fail trims the error code to 200 characters and blanks become 'unknown'", async () => {
    const store = new MemoryGenerationJobStore();
    store.seed(USER, 2);
    const a = await store.start({
      userId: USER,
      kind: "look",
      clientRequestId: REQ_A,
      input: {},
      charge: true,
      dailyAllowance: 1,
      deadlineSeconds: 30,
    });
    await store.fail(a.job.id, `  ${"x".repeat(250)}  `, true);
    const b = await store.start({
      userId: USER,
      kind: "look",
      clientRequestId: REQ_B,
      input: {},
      charge: true,
      dailyAllowance: 1,
      deadlineSeconds: 30,
    });
    await store.fail(b.job.id, "   ", true);

    expect(store.rows[0].error_code).toBe("x".repeat(200));
    expect(store.rows[1].error_code).toBe("unknown");
  });

  test("an upload never overwrites an existing object (upsert:false)", async () => {
    const store = new MemoryGenerationJobStore();
    await store.uploadImage(`${USER}/a.jpg`, new Uint8Array([1]), "image/jpeg");
    await expect(
      store.uploadImage(`${USER}/a.jpg`, new Uint8Array([2]), "image/jpeg"),
    ).rejects.toBeInstanceOf(GenerationImageExistsError);
  });
});

describe("persist failure ruling (coordinator, round 1)", () => {
  test("an upload that fails once is retried and the job completes normally", async () => {
    const { store, deps } = setup();
    store.failUploadTimes = 1;

    const out = await withGenerationJob(
      renderSpec(),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );

    const row = store.rows[0];
    expect(out).toEqual({
      status: "done",
      jobId: row.id,
      value: { imageDataUri: JPEG_DATA_URI, mode: "render" },
      replayed: false,
    });
    expect(store.calls.uploads).toBe(2);
    expect(row.status).toBe("succeeded");
    expect(row.image_path).toBe(`${USER}/${row.id}.jpg`);
    expect(store.calls.refunds).toBe(0);
  });

  test("a complete that fails once is retried and the job completes normally", async () => {
    const { store, deps } = setup();
    store.failCompleteTimes = 1;

    const out = await withGenerationJob(lookSpec(), async () => ({ headline: "Linen day" }), deps);

    expect(out.status === "done" && out.jobId).toBe(store.rows[0].id);
    expect(store.rows[0].status).toBe("succeeded");
    expect(store.calls.complete).toBe(2);
  });

  test("an upload that landed but lost its answer is not re-written: the retry completes the job", async () => {
    const { store, deps } = setup();
    store.loseUploadAnswerTimes = 1;

    const out = await withGenerationJob(
      renderSpec(),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );

    expect(out.status === "done" && out.jobId).toBe(store.rows[0].id);
    expect(store.rows[0].status).toBe("succeeded");
    expect(store.images.size).toBe(1);
  });

  test("a free render whose persist keeps failing is delivered and the free slot stays spent", async () => {
    const { store, deps } = setup(1);
    store.failUpload = true;
    const release = mock(async () => {});

    const out = await withGenerationJob(
      renderSpec({ freeSlot: { claim: async () => true, release } }),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );

    expect(out.status === "done" && out.value).toEqual({
      imageDataUri: JPEG_DATA_URI,
      mode: "render",
    });
    expect(release).not.toHaveBeenCalled();
    expect(store.balance(USER).daily).toBe(1);
  });

  test("a delivered-but-unstored result is reported loudly", async () => {
    const { store, deps } = setup();
    store.failUpload = true;
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await withGenerationJob(
        renderSpec(),
        async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
        deps,
      );
      expect(
        error.mock.calls.some((args) => String(args[0]).includes("delivered without being stored")),
      ).toBe(true);
    } finally {
      error.mockRestore();
    }
  });

  test("produce failing still refunds (unchanged)", async () => {
    const { store, deps } = setup(1);
    await expect(
      withGenerationJob(
        lookSpec(),
        async () => {
          throw new Error("provider down");
        },
        deps,
      ),
    ).rejects.toThrow("provider down");
    expect(store.rows[0].credit_state).toBe("refunded");
    expect(store.balance(USER).daily).toBe(1);
  });

  test("an attach wait always ends, even if the clock never moves", async () => {
    const frozen = 1_000_000;
    const store = new MemoryGenerationJobStore(() => frozen);
    store.seed(USER, 5);
    await store.start({
      userId: USER,
      kind: "look",
      clientRequestId: REQ_B,
      input: { vibe: "Work" },
      charge: true,
      dailyAllowance: 1,
      deadlineSeconds: 300,
    });

    const err = await withGenerationJob(
      lookSpec({ clientRequestId: undefined }),
      async () => ({ headline: "x" }),
      {
        store,
        availability: createAvailabilityCache(60_000),
        now: () => frozen,
        sleep: async () => {},
      },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GenerationInFlightError);
  });
});

describe("memory store follows the migration's Revision 2 refund rules", () => {
  const DAY1_2359 = Date.parse("2026-10-07T23:59:00Z");
  const DAY2_0001 = Date.parse("2026-10-08T00:01:00Z");

  function ledger(at: number) {
    let clock = at;
    const store = new MemoryGenerationJobStore(() => clock);
    return {
      store,
      setClock: (ms: number) => {
        clock = ms;
      },
      start: (kind: GenerationJobSpec<unknown>["kind"], req: string, allowance: number) =>
        store.start({
          userId: USER,
          kind,
          clientRequestId: req,
          input: {},
          charge: true,
          dailyAllowance: allowance,
          deadlineSeconds: 300,
        }),
    };
  }

  test("a purchased refund returns to purchased at once", async () => {
    const { store, start } = ledger(DAY1_2359);
    store.seed(USER, 0, 2);
    const { job } = await start("look", REQ_A, 0);
    expect(job.charged_from).toBe("purchased");

    const { job: failed } = await store.fail(job.id, "x", true);

    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 2 });
    expect(failed.credit_state).toBe("refunded");
    expect(failed.refund_applied_at).not.toBeNull();
  });

  test("a same-day daily refund returns to today's pool at once, never purchased", async () => {
    const { store, start } = ledger(DAY1_2359);
    store.seed(USER, 2, 0);
    const { job } = await start("look", REQ_A, 2);

    const { job: failed } = await store.fail(job.id, "x", true);

    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });
    expect(failed.refund_applied_at).not.toBeNull();
  });

  test("a rolled-over daily refund is owed, then lands exactly once when the day is stamped", async () => {
    const { store, setClock, start } = ledger(DAY1_2359);
    store.seed(USER, 3, 0);
    const { job } = await start("look", REQ_A, 3);
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });

    setClock(DAY2_0001);
    const { job: failed } = await store.fail(job.id, "x", true);
    // Day 2's pool is not stamped yet: owed, nothing written to a stale pool.
    expect(failed.credit_state).toBe("refunded");
    expect(failed.refund_applied_at).toBeNull();
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });

    // A start stamps day 2 (allowance 3, spends 1) and the owed credit lands.
    await start("style_sheet", REQ_B, 3);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
    expect(store.rows[0].refund_applied_at).not.toBeNull();

    // Never twice.
    await store.reap(USER);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
  });

  test("a refused spend that an owed refund can pay for spends again", async () => {
    const { store, setClock, start } = ledger(DAY1_2359);
    store.seed(USER, 1, 0);
    const { job } = await start("look", REQ_A, 1);
    setClock(DAY2_0001);
    await store.fail(job.id, "x", true);

    // Day 2 allowance 0: consume refuses, stamps the day, the owed credit
    // lands, and is spent.
    const second = await start("look", REQ_B, 0);

    expect(second.outcome).toBe("started");
    expect(second.job.charged_from).toBe("daily");
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 0 });
  });

  test("allowance first: a purchased spend is swapped for a daily credit that landed after it", async () => {
    const { store, setClock, start } = ledger(DAY1_2359);
    store.seed(USER, 1, 1);
    const { job } = await start("look", REQ_A, 1);
    expect(job.charged_from).toBe("daily");
    setClock(DAY2_0001);
    await store.fail(job.id, "x", true);

    const second = await start("look", REQ_B, 0);

    expect(second.job.charged_from).toBe("daily");
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 1 });
  });

  test("complete and fail only write rows that are still running", async () => {
    const { store, start } = ledger(DAY1_2359);
    store.seed(USER, 5, 0);
    const a = await start("look", REQ_A, 5);
    await store.complete(a.job.id, { ok: true }, null);

    const failSucceeded = await store.fail(a.job.id, "late", true);
    expect(failSucceeded.outcome).toBe("not_running");
    expect(failSucceeded.job.status).toBe("succeeded");
    expect(failSucceeded.job.error_code).toBeNull();
    expect(failSucceeded.job.credit_state).toBe("charged");

    const b = await start("style_sheet", REQ_B, 5);
    await store.fail(b.job.id, "x", false);
    const completeFailed = await store.complete(b.job.id, { ok: true }, null);
    expect(completeFailed.outcome).toBe("not_running");
    expect(completeFailed.job.status).toBe("failed");
    expect(completeFailed.job.result).toBeNull();
  });

  test("every returned job carries refund_applied_at", async () => {
    const { store, start } = ledger(DAY1_2359);
    store.seed(USER, 1, 0);
    const { job } = await start("look", REQ_A, 1);
    expect(job).toHaveProperty("refund_applied_at", null);
  });
});

describe("re-review round 2", () => {
  test("N1: reaper wins, then persist fails twice: the refunded job is NOT also delivered", async () => {
    let clock = 1_000_000;
    const store = new MemoryGenerationJobStore(() => clock);
    store.seed(USER, 5);
    let completes = 0;
    store.complete = async () => {
      completes += 1;
      if (completes === 1) {
        clock += 340_000; // past deadline + 30 s
        await store.reap(USER); // the cron or another request reaps it
      }
      throw new Error("complete failed");
    };

    await expect(
      withGenerationJob(
        lookSpec({ deadlineSeconds: 300 }),
        async () => ({ headline: "Linen day" }),
        {
          store,
          availability: createAvailabilityCache(60_000),
          now: () => clock,
          persistReserveMs: 0,
        },
      ),
    ).rejects.toThrow("failed:deadline_exceeded");
    expect(store.rows[0].credit_state).toBe("refunded");
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER).daily).toBe(5);
  });

  test("N1: a reaped free render whose persist failed gets the failure and its slot back, not the render", async () => {
    let clock = 1_000_000;
    const store = new MemoryGenerationJobStore(() => clock);
    store.seed(USER, 5);
    store.failUpload = true;
    const release = mock(async () => {});
    const realUpload = store.uploadImage.bind(store);
    let uploads = 0;
    store.uploadImage = async (path, bytes, type) => {
      uploads += 1;
      if (uploads === 1) {
        clock += 340_000;
        await store.reap(USER);
      }
      return realUpload(path, bytes, type);
    };

    const out = await withGenerationJob(
      renderSpec({ deadlineSeconds: 300, freeSlot: { claim: async () => true, release } }),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      {
        store,
        availability: createAvailabilityCache(60_000),
        now: () => clock,
        persistReserveMs: 0,
      },
    );

    expect(out.status === "done" && out.value).toEqual({
      imageDataUri: null,
      mode: "unavailable",
      reason: "deadline_exceeded",
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("N3: a keep-the-charge fail that errors once is retried and the charge is recorded", async () => {
    const { store, deps } = setup();
    store.failUpload = true;
    const realFail = store.fail.bind(store);
    let keepFails = 0;
    store.fail = async (id, code, refund) => {
      if (!refund && keepFails === 0) {
        keepFails += 1;
        throw new Error("db blip");
      }
      return realFail(id, code, refund);
    };

    const out = await withGenerationJob(
      renderSpec(),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );

    expect(out.status === "done" && out.value.imageDataUri).toBe(JPEG_DATA_URI);
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].error_code).toBe("persist_failed_delivered");
    expect(store.rows[0].credit_state).toBe("charged");
  });

  test("N3: when the keep-the-charge fail never lands, the log tells the truth (the reaper will refund)", async () => {
    const { store, deps } = setup();
    store.failUpload = true;
    const realFail = store.fail.bind(store);
    store.fail = async (id, code, refund) => {
      if (!refund) throw new Error("db unreachable");
      return realFail(id, code, refund);
    };
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await withGenerationJob(
        renderSpec(),
        async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
        deps,
      );
      expect(out.status === "done" && out.value.imageDataUri).toBe(JPEG_DATA_URI);
      const lines = error.mock.calls.map((args) => String(args[0]));
      expect(lines.some((l) => l.includes("the charge is kept"))).toBe(false);
      expect(lines.some((l) => l.includes("the reaper will refund it"))).toBe(true);
      expect(store.rows[0].status).toBe("running");
    } finally {
      error.mockRestore();
    }
  });

  test("N4: a complete that committed but lost its answer uses the render in hand, never a re-download", async () => {
    const { store, deps } = setup();
    const realComplete = store.complete.bind(store);
    let completes = 0;
    store.complete = async (id, result, path) => {
      completes += 1;
      const answer = await realComplete(id, result, path);
      if (completes === 1) throw new Error("connection reset after commit");
      return answer;
    };
    const download = mock(async () => {
      throw new Error("storage blip");
    });
    store.downloadImage = download;

    const out = await withGenerationJob(
      renderSpec(),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );

    expect(out).toEqual({
      status: "done",
      jobId: store.rows[0].id,
      value: { imageDataUri: JPEG_DATA_URI, mode: "render" },
      replayed: false,
    });
    expect(download).not.toHaveBeenCalled();
    expect(store.rows[0].status).toBe("succeeded");
  });

  test("N5: with the server clock ahead of the database, the self-reap is retried until it lands", async () => {
    let clock = 1_000_000; // server clock
    const store = new MemoryGenerationJobStore(() => clock - 4_000); // DB 4 s behind
    store.seed(USER, 5);
    await store.start({
      userId: USER,
      kind: "style_sheet",
      clientRequestId: REQ_B,
      input: { headline: "H" },
      charge: true,
      dailyAllowance: 5,
      deadlineSeconds: 300,
    });
    clock += 300_000 + 10_000;

    const out = await withGenerationJob(
      renderSpec({ clientRequestId: undefined }),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      {
        store,
        availability: createAvailabilityCache(60_000),
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );

    expect(out.status === "done" && out.value).toEqual({
      imageDataUri: null,
      mode: "unavailable",
      reason: "deadline_exceeded",
    });
    expect(store.rows[0].status).toBe("failed");
    expect(store.calls.refunds).toBe(1);
  });

  test("N5: the self-reap is bounded: it gives up and answers 'try again' rather than looping", async () => {
    let clock = 1_000_000;
    const store = new MemoryGenerationJobStore(() => clock);
    store.seed(USER, 5);
    await store.start({
      userId: USER,
      kind: "look",
      clientRequestId: REQ_B,
      input: { vibe: "Work" },
      charge: true,
      dailyAllowance: 5,
      deadlineSeconds: 300,
    });
    clock += 300_000 + 10_000;
    let reaps = 0;
    store.reap = async () => {
      reaps += 1;
      throw new Error("db blip");
    };

    const err = await withGenerationJob(
      lookSpec({ clientRequestId: undefined }),
      async () => ({ headline: "x" }),
      {
        store,
        availability: createAvailabilityCache(60_000),
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GenerationInFlightError);
    // One pre-start reap plus a bounded number of self-reaps while waiting.
    expect(reaps).toBeGreaterThan(2);
    expect(reaps).toBeLessThanOrEqual(1 + 8);
  });

  test("N6: a null field and a missing field compare equal, at any depth and in any order", () => {
    expect(stableJson({ vibe: "Work", skinUndertone: null })).toBe(stableJson({ vibe: "Work" }));
    expect(stableJson({ a: { b: null, c: 1 }, z: 2 })).toBe(stableJson({ z: 2, a: { c: 1 } }));
  });

  test("N6: two different requests are still judged different", () => {
    expect(stableJson({ vibe: "Work" })).not.toBe(stableJson({ vibe: "Date night" }));
    expect(stableJson({ vibe: "Work", faceShape: "Oval" })).not.toBe(stableJson({ vibe: "Work" }));
    expect(stableJson({ outfit: { picks: [1, 2] } })).not.toBe(
      stableJson({ outfit: { picks: [2, 1] } }),
    );
    expect(stableJson({ picks: [null, 1] })).not.toBe(stableJson({ picks: [1] }));
    expect(stableJson({ a: 0 })).not.toBe(stableJson({}));
    expect(stableJson({ a: "" })).not.toBe(stableJson({}));
  });

  test("N6: a web request sending null attaches to a mobile request that omitted the field", async () => {
    const { store, deps } = setup(5);
    const gate = deferred<Look>();
    const first = withGenerationJob(
      lookSpec({ input: { vibe: "Work" } }),
      () => gate.promise,
      deps,
    );
    await new Promise((r) => setTimeout(r, 5));
    const attached = withGenerationJob(
      lookSpec({ clientRequestId: undefined, input: { vibe: "Work", faceShape: null } }),
      async () => ({ headline: "must not run" }),
      deps,
    );
    setTimeout(() => gate.resolve({ headline: "Linen day" }), 10);

    const [, b] = await Promise.all([first, attached]);
    expect(b.status === "done" && b.value).toEqual({ headline: "Linen day" });
    expect(store.balance(USER).daily).toBe(4);
  });

  test("fake get() drops input exactly like the real adapter's polled columns", async () => {
    const store = new MemoryGenerationJobStore();
    store.seed(USER, 5);
    const { job } = await store.start({
      userId: USER,
      kind: "look",
      clientRequestId: REQ_A,
      input: { vibe: "Work" },
      charge: true,
      dailyAllowance: 5,
      deadlineSeconds: 300,
    });
    expect((await store.get(job.id))?.input).toBeNull();
  });

  test("fake mirrors the SQL guards: no entitlements row, unknown kind, bad deadline", async () => {
    const store = new MemoryGenerationJobStore();
    const args = {
      userId: "nobody",
      kind: "look" as const,
      clientRequestId: REQ_A,
      input: {},
      charge: true,
      dailyAllowance: 3,
      deadlineSeconds: 300,
    };
    expect(await store.start(args).catch((e: unknown) => e)).toBeInstanceOf(
      GenerationJobStoreError,
    );
    store.seed(USER, 3);
    expect(
      await store.start({ ...args, userId: USER, kind: "nope" as never }).catch((e: unknown) => e),
    ).toBeInstanceOf(GenerationJobStoreError);
    expect(
      await store.start({ ...args, userId: USER, deadlineSeconds: 4000 }).catch((e: unknown) => e),
    ).toBeInstanceOf(GenerationJobStoreError);
    expect(store.rows).toHaveLength(0);
  });
});

describe("re-review 2: NEW-A", () => {
  /** keep-the-charge fail commits, then its first answer is lost on the wire. */
  function loseFirstKeepAnswer(store: MemoryGenerationJobStore) {
    const realFail = store.fail.bind(store);
    let keeps = 0;
    store.fail = async (id, code, refund) => {
      const answer = await realFail(id, code, refund);
      if (!refund) {
        keeps += 1;
        if (keeps === 1) throw new Error("connection reset after commit");
      }
      return answer;
    };
  }

  test("a keep-the-charge fail that committed but lost its answer still hands her the render", async () => {
    const { store, deps } = setup();
    store.failUpload = true;
    loseFirstKeepAnswer(store);
    const release = mock(async () => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await withGenerationJob(
        renderSpec({ freeSlot: { claim: async () => false, release } }),
        async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
        deps,
      );

      expect(out).toEqual({
        status: "done",
        jobId: null,
        value: { imageDataUri: JPEG_DATA_URI, mode: "render" },
        replayed: false,
      });
      expect(store.rows[0].error_code).toBe("persist_failed_delivered");
      expect(store.rows[0].credit_state).toBe("charged");
      expect(store.calls.refunds).toBe(0);
      expect(release).not.toHaveBeenCalled();
      expect(error.mock.calls.some((args) => String(args[0]).includes("the charge is kept"))).toBe(
        true,
      );
    } finally {
      error.mockRestore();
    }
  });

  test("a free render whose keep-the-charge answer was lost keeps its slot spent and is delivered", async () => {
    const { store, deps } = setup(1);
    store.failUpload = true;
    loseFirstKeepAnswer(store);
    const release = mock(async () => {});

    const out = await withGenerationJob(
      renderSpec({ freeSlot: { claim: async () => true, release } }),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      deps,
    );

    expect(out.status === "done" && out.value.imageDataUri).toBe(JPEG_DATA_URI);
    expect(release).not.toHaveBeenCalled();
    expect(store.balance(USER).daily).toBe(1);
  });

  test("a row reaped (deadline_exceeded) before the keep call is still answered as a failure", async () => {
    let clock = 1_000_000;
    const store = new MemoryGenerationJobStore(() => clock);
    store.seed(USER, 5);
    store.failUpload = true;
    const realUpload = store.uploadImage.bind(store);
    let uploads = 0;
    store.uploadImage = async (path, bytes, type) => {
      uploads += 1;
      if (uploads === 2) {
        clock += 340_000;
        await store.reap(USER);
      }
      return realUpload(path, bytes, type);
    };

    const out = await withGenerationJob(
      renderSpec({ deadlineSeconds: 300 }),
      async () => ({ imageDataUri: JPEG_DATA_URI, mode: "render" as const }),
      {
        store,
        availability: createAvailabilityCache(60_000),
        now: () => clock,
        persistReserveMs: 0,
      },
    );

    expect(out.status === "done" && out.value.mode).toBe("unavailable");
    expect(store.rows[0].credit_state).toBe("refunded");
  });
});

describe("P2B-S0: a refunded result is kept, and no job stores more than 64 KB", () => {
  type Hunt = { identifiedAs: string; dupes: string[]; creditRefunded: boolean; note?: string };
  /** Nothing close in the catalogue: refunded, and what Mila identified is kept. */
  const REFUNDED_HUNT: Hunt = { identifiedAs: "Linen shirt", dupes: [], creditRefunded: true };

  function huntSpec(overrides: Partial<GenerationJobSpec<Hunt>> = {}): GenerationJobSpec<Hunt> {
    return {
      kind: "dupe_search",
      userId: USER,
      clientRequestId: REQ_A,
      input: { imageUrl: "https://example.test/look.jpg", maxResults: 6 },
      charge: true,
      dailyAllowance: 1,
      deadlineSeconds: 30,
      settle: (hunt) =>
        hunt.creditRefunded
          ? { ok: false, errorCode: "no_close_match", result: hunt }
          : { ok: true, result: hunt },
      fromStored: ({ result }) => result as unknown as Hunt,
      failure: (code, stored) => {
        if (stored?.result) return stored.result as unknown as Hunt;
        throw new Error(`failed:${code}`);
      },
      legacy: async () => ({ identifiedAs: "legacy", dupes: [], creditRefunded: false }),
      ...overrides,
    };
  }

  function keepStored() {
    return mock((_code: string, stored?: { result: Json | null }) => {
      return stored?.result as unknown as Hunt;
    });
  }

  test("a refundable failure keeps its result on the failed row and refunds once", async () => {
    const { store, deps } = setup(1, 0);

    const out = await withGenerationJob(huntSpec(), async () => REFUNDED_HUNT, deps);

    expect(out).toEqual({
      status: "done",
      jobId: store.rows[0].id,
      value: REFUNDED_HUNT,
      replayed: false,
    });
    expect(store.rows[0]).toMatchObject({
      status: "failed",
      error_code: "no_close_match",
      result: REFUNDED_HUNT,
      credit_state: "refunded",
    });
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER)).toEqual({ daily: 1, purchased: 0 });
  });

  test("a replay of a refunded job answers failure(code, { result }) and charges nothing", async () => {
    const { store, deps } = setup(5);
    await withGenerationJob(huntSpec(), async () => REFUNDED_HUNT, deps);
    const produce = mock(async () => ({ ...REFUNDED_HUNT, identifiedAs: "must not run" }));
    const failure = keepStored();

    const again = await withGenerationJob(huntSpec({ failure }), produce, deps);

    expect(produce).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledWith("no_close_match", { result: REFUNDED_HUNT });
    expect(again).toEqual({
      status: "done",
      jobId: store.rows[0].id,
      value: REFUNDED_HUNT,
      replayed: true,
    });
    expect(store.rows).toHaveLength(1);
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER).daily).toBe(5);
  });

  test("a caller attached behind a hunt that gets refunded is answered from the polled row's result", async () => {
    const { store, deps } = setup(5);
    const gate = deferred<Hunt>();
    const first = withGenerationJob(huntSpec(), () => gate.promise, deps);
    await new Promise((r) => setTimeout(r, 5));
    const failure = keepStored();
    const attached = withGenerationJob(
      huntSpec({ clientRequestId: undefined, failure }),
      async () => {
        throw new Error("must not run");
      },
      deps,
    );
    setTimeout(() => gate.resolve(REFUNDED_HUNT), 10);

    const [a, b] = await Promise.all([first, attached]);

    expect(a.status === "done" && a.value).toEqual(REFUNDED_HUNT);
    expect(b).toEqual({
      status: "done",
      jobId: store.rows[0].id,
      value: REFUNDED_HUNT,
      replayed: true,
    });
    expect(failure).toHaveBeenCalledWith("no_close_match", { result: REFUNDED_HUNT });
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER).daily).toBe(5);
  });

  test("a replayed failure that kept nothing is answered failure(code, { result: null })", async () => {
    const { deps } = setup(5);
    await withGenerationJob(
      renderSpec(),
      async () => ({ imageDataUri: null, mode: "unavailable" as const }),
      deps,
    );
    const failure = mock((code: string) => ({
      imageDataUri: null,
      mode: "unavailable" as const,
      reason: code,
    }));

    await withGenerationJob(
      renderSpec({ failure }),
      async () => ({ imageDataUri: null, mode: "unavailable" as const }),
      deps,
    );

    expect(failure).toHaveBeenCalledWith("unavailable", { result: null });
  });

  test("a success result over 64 KB is delivered, kept charged and recorded persist_failed_delivered", async () => {
    expect(MAX_JOB_RESULT_CHARS).toBe(65_536);
    const { store, deps } = setup();
    const big = { headline: "x".repeat(70_000) };

    const out = await withGenerationJob(lookSpec(), async () => big, deps);

    expect(out).toEqual({ status: "done", jobId: null, value: big, replayed: false });
    expect(store.rows[0]).toMatchObject({
      status: "failed",
      error_code: "persist_failed_delivered",
      result: null,
      credit_state: "charged",
    });
    expect(store.calls.complete).toBe(0);
    expect(store.calls.refunds).toBe(0);
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 0 });
  });

  test("a result of exactly 64 KB is stored; one byte more is not", async () => {
    const { store, deps } = setup(2);
    const envelope = JSON.stringify({ headline: "" }).length;
    const atCap = { headline: "x".repeat(65_536 - envelope) };
    const overCap = { headline: "x".repeat(65_536 - envelope + 1) };

    const stored = await withGenerationJob(lookSpec(), async () => atCap, deps);
    const refused = await withGenerationJob(
      lookSpec({ clientRequestId: REQ_B }),
      async () => overCap,
      deps,
    );

    expect(stored.status === "done" && stored.jobId).toBe(store.rows[0].id);
    expect(store.rows[0].status).toBe("succeeded");
    expect(refused.status === "done" && refused.jobId).toBeNull();
    expect(store.rows[1].error_code).toBe("persist_failed_delivered");
  });

  test("the 64 KB cap counts UTF-8 bytes, the unit the database measures", async () => {
    const { store, deps } = setup();
    // 30 000 characters, about 90 000 bytes once encoded.
    const wide = { headline: "…".repeat(30_000) };

    const out = await withGenerationJob(lookSpec(), async () => wide, deps);

    expect(out.status === "done" && out.jobId).toBeNull();
    expect(store.rows[0].error_code).toBe("persist_failed_delivered");
    expect(store.rows[0].result).toBeNull();
  });

  test("a failure result with an inline image is dropped; the job is still failed and refunded", async () => {
    const { store, deps } = setup(1);

    const out = await withGenerationJob(
      huntSpec({
        settle: () => ({
          ok: false,
          errorCode: "no_close_match",
          result: { inspiration: JPEG_DATA_URI },
        }),
      }),
      async () => REFUNDED_HUNT,
      deps,
    );

    expect(out).toEqual({
      status: "done",
      jobId: store.rows[0].id,
      value: REFUNDED_HUNT,
      replayed: false,
    });
    expect(store.rows[0]).toMatchObject({
      status: "failed",
      error_code: "no_close_match",
      result: null,
      credit_state: "refunded",
    });
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER).daily).toBe(1);
  });

  test("a failure result over 64 KB is dropped; the job is still failed and refunded", async () => {
    const { store, deps } = setup(1);

    await withGenerationJob(
      huntSpec({
        settle: (hunt) => ({
          ok: false,
          errorCode: "no_close_match",
          result: { ...hunt, note: "x".repeat(70_000) },
        }),
      }),
      async () => REFUNDED_HUNT,
      deps,
    );

    expect(store.rows[0]).toMatchObject({
      status: "failed",
      result: null,
      credit_state: "refunded",
    });
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER).daily).toBe(1);
  });

  test("a failure result that is not a JSON object is dropped (the database keeps objects only)", async () => {
    const { store, deps } = setup(1);

    await withGenerationJob(
      huntSpec({
        settle: () => ({ ok: false, errorCode: "no_close_match", result: ["Linen shirt"] }),
      }),
      async () => REFUNDED_HUNT,
      deps,
    );

    expect(store.rows[0]).toMatchObject({
      status: "failed",
      result: null,
      credit_state: "refunded",
    });
    expect(store.calls.refunds).toBe(1);
  });

  test("with fail_generation_job_with_result missing, the refund is unchanged and only the result is not kept", async () => {
    const { store, deps } = setup(1);
    store.missingFailWithResult = true;

    const out = await withGenerationJob(huntSpec(), async () => REFUNDED_HUNT, deps);

    expect(out).toEqual({
      status: "done",
      jobId: store.rows[0].id,
      value: REFUNDED_HUNT,
      replayed: false,
    });
    expect(store.rows[0]).toMatchObject({
      status: "failed",
      error_code: "no_close_match",
      result: null,
      credit_state: "refunded",
    });
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER).daily).toBe(1);
  });

  test("memory store: fail with a result mirrors fail_generation_job_with_result", async () => {
    const store = new MemoryGenerationJobStore();
    store.seed(USER, 5);
    const start = (req: string) =>
      store.start({
        userId: USER,
        kind: "dupe_search",
        clientRequestId: req,
        input: {},
        charge: true,
        dailyAllowance: 5,
        deadlineSeconds: 30,
      });

    // Running -> failed: the result is written and the credit comes back once.
    const a = await start(REQ_A);
    const first = await store.fail(a.job.id, "no_close_match", true, { identifiedAs: "A" });
    expect(first.outcome).toBe("failed");
    expect(first.job.result).toEqual({ identifiedAs: "A" });
    expect(store.calls.refunds).toBe(1);

    // A second call answers not_running, keeps the first result, refunds nothing.
    const again = await store.fail(a.job.id, "other", true, { identifiedAs: "B" });
    expect(again.outcome).toBe("not_running");
    expect(again.job.result).toEqual({ identifiedAs: "A" });
    expect(again.job.error_code).toBe("no_close_match");
    expect(store.calls.refunds).toBe(1);

    // A succeeded row is returned untouched.
    const b = await start(REQ_B);
    await store.complete(b.job.id, { dupes: [] }, null);
    const late = await store.fail(b.job.id, "no_close_match", true, { identifiedAs: "C" });
    expect(late.outcome).toBe("not_running");
    expect(late.job).toMatchObject({
      status: "succeeded",
      result: { dupes: [] },
      error_code: null,
    });

    // A non-object or a result over 65 536 bytes raises invalid_result and changes nothing.
    const c = await start("00000000-0000-4000-8000-00000000000c");
    const refundsBefore = store.calls.refunds;
    await expect(store.fail(c.job.id, "x", true, ["A"])).rejects.toThrow("invalid_result");
    await expect(store.fail(c.job.id, "x", true, { note: "x".repeat(70_000) })).rejects.toThrow(
      "invalid_result",
    );
    expect(store.rows.find((r) => r.id === c.job.id)?.status).toBe("running");
    expect(store.calls.refunds).toBe(refundsBefore);
  });
});

describe("P2B-S0: produce can ask whether its job is still the live one before it writes", () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test("a produce that checks stillRunning() after the deadline sees false", async () => {
    const { store, deps } = setup();
    const seen: boolean[] = [];
    let lateCheck: Promise<void> = Promise.resolve();

    const out = await withGenerationJob(
      renderSpec({ deadlineSeconds: 0.03 }),
      (job) => {
        lateCheck = (async () => {
          seen.push(await job.stillRunning());
          await wait(60);
          seen.push(await job.stillRunning());
        })();
        return new Promise<Render>(() => {});
      },
      deps,
    );
    await lateCheck;

    expect(out.status === "done" && out.value.reason).toBe("deadline_exceeded");
    expect(store.calls.refunds).toBe(1);
    expect(seen).toEqual([true, false]);
  });

  test("signal.aborted is true after the deadline", async () => {
    const { deps } = setup();
    let signal: AbortSignal | null = null;
    let abortedAtStart: boolean | null = null;

    await withGenerationJob(
      renderSpec({ deadlineSeconds: 0.03 }),
      (job) => {
        signal = job.signal;
        abortedAtStart = job.signal.aborted;
        return new Promise<Render>(() => {});
      },
      deps,
    );

    expect(abortedAtStart).toBe(false);
    const after = signal as AbortSignal | null;
    expect(after?.aborted).toBe(true);
    expect((after?.reason as DOMException | undefined)?.name).toBe("TimeoutError");
  });

  test("a produce that rejects as its signal aborts is still answered as a deadline failure", async () => {
    const { store, deps } = setup();

    const out = await withGenerationJob(
      renderSpec({ deadlineSeconds: 0.03 }),
      // Like fetch(url, { signal }): rejects the moment the signal aborts.
      (job) =>
        new Promise<Render>((_resolve, reject) => {
          job.signal.addEventListener("abort", () => reject(job.signal.reason));
        }),
      deps,
    );

    expect(out.status === "done" && out.value.reason).toBe("deadline_exceeded");
    expect(store.rows[0].error_code).toBe("deadline_exceeded");
    expect(store.calls.refunds).toBe(1);
  });

  test("past the deadline stillRunning() is false even before the refund write lands", async () => {
    const { store, deps } = setup();
    const realFail = store.fail.bind(store);
    const failGate = deferred<void>();
    store.fail = async (id, code, refund, result) => {
      await failGate.promise;
      return realFail(id, code, refund, result);
    };
    let seenWhileRowRunning: boolean | null = null;
    let rowStatusThen: string | null = null;

    const pending = withGenerationJob(
      renderSpec({ deadlineSeconds: 0.03 }),
      async (job) => {
        try {
          await wait(60);
          rowStatusThen = store.rows[0].status;
          seenWhileRowRunning = await job.stillRunning();
        } finally {
          failGate.resolve();
        }
        return { imageDataUri: JPEG_DATA_URI, mode: "render" as const };
      },
      deps,
    );
    const out = await pending;
    await wait(5);

    expect(rowStatusThen).toBe("running");
    expect(seenWhileRowRunning).toBe(false);
    expect(out.status === "done" && out.value.reason).toBe("deadline_exceeded");
    expect(store.calls.refunds).toBe(1);
  });

  test("stillRunning() re-reads the row: a job reaped under produce answers false", async () => {
    let clock = 1_000_000;
    const store = new MemoryGenerationJobStore(() => clock);
    store.seed(USER, 1);
    let seen: boolean | null = null;

    await withGenerationJob(
      renderSpec({ deadlineSeconds: 1 }),
      async (job) => {
        clock += 40_000; // the reaper's grace has passed on the database clock
        await store.reap(USER);
        seen = await job.stillRunning();
        return { imageDataUri: JPEG_DATA_URI, mode: "render" as const };
      },
      {
        store,
        availability: createAvailabilityCache(60_000),
        now: () => clock,
        persistReserveMs: 0,
      },
    );

    expect(seen).toBe(false);
    expect(store.rows[0].status).toBe("failed");
    expect(store.calls.refunds).toBe(1);
  });

  test("stillRunning() answers false when the row cannot be read (no write on a guess)", async () => {
    const { store, deps } = setup();
    store.get = async () => {
      throw new Error("db blip");
    };
    let seen: boolean | null = null;
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await withGenerationJob(
        lookSpec(),
        async (job) => {
          seen = await job.stillRunning();
          return { headline: "Linen day" };
        },
        deps,
      );
    } finally {
      error.mockRestore();
    }
    expect(seen).toBe(false);
  });

  test("a job that finishes in time sees stillRunning() true and its signal never aborts", async () => {
    const { store, deps } = setup();
    let job: { jobId: string; signal: AbortSignal; stillRunning: () => Promise<boolean> } | null =
      null;
    let seen: boolean | null = null;

    await withGenerationJob(
      lookSpec(),
      async (context) => {
        job = context;
        seen = await context.stillRunning();
        return { headline: "Linen day" };
      },
      deps,
    );
    await wait(5);

    const ran = job as { jobId: string; signal: AbortSignal } | null;
    expect(seen).toBe(true);
    expect(ran?.jobId).toBe(store.rows[0].id);
    expect(ran?.signal.aborted).toBe(false);
    expect(store.rows[0].status).toBe("succeeded");
  });

  test("the legacy path gets a context whose stillRunning() is always true", async () => {
    const { store, deps } = setup();
    store.missing = true;
    let context: {
      jobId: string | null;
      signal: AbortSignal;
      stillRunning: () => Promise<boolean>;
    } | null = null;
    const legacy = mock(async (ctx?: typeof context) => {
      context = ctx ?? null;
      return { headline: "legacy" };
    });

    await withGenerationJob(lookSpec({ legacy }), async () => ({ headline: "new" }), deps);

    const given = context as typeof context;
    expect(given).not.toBeNull();
    expect(given?.jobId).toBeNull();
    expect(given?.signal.aborted).toBe(false);
    expect(await given?.stillRunning()).toBe(true);
  });
});

describe("P2B-S0 fix round 1: a write the wrapper said yes to gets the grace", () => {
  /** Virtual time for the deadline timers: `advanceTo` runs every timer due
   * by then, in order, and lets promise chains settle after each. */
  function virtualTime() {
    let now = 0;
    let seq = 0;
    const timers: { at: number; seq: number; run: () => void }[] = [];
    const settle = async () => {
      for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
    };
    const schedule = (run: () => void, ms: number) => {
      seq += 1;
      const timer = { at: now + Math.max(0, ms), seq, run };
      timers.push(timer);
      return () => {
        const at = timers.indexOf(timer);
        if (at >= 0) timers.splice(at, 1);
      };
    };
    return {
      now: () => now,
      schedule,
      until: (at: number) =>
        new Promise<void>((resolve) => {
          schedule(resolve, at - now);
        }),
      async advanceTo(target: number) {
        await settle();
        for (;;) {
          timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
          const next = timers[0];
          if (!next || next.at > target) break;
          timers.shift();
          now = next.at;
          next.run();
          await settle();
        }
        now = target;
        await settle();
      },
    };
  }

  function clocked(daily = 1) {
    const vt = virtualTime();
    const store = new MemoryGenerationJobStore(vt.now);
    store.seed(USER, daily);
    const deps: GenerationJobDeps = {
      store,
      availability: createAvailabilityCache(60_000),
      now: vt.now,
      schedule: vt.schedule,
    };
    return { vt, store, deps };
  }

  test("a write that starts at 284 s and finishes at 290 s is completed and charged once, with no refund", async () => {
    const { vt, store, deps } = clocked();
    let wroteAt: number | null = null;
    let abortedWhileWriting: boolean | null = null;

    const pending = withGenerationJob(
      lookSpec({ deadlineSeconds: 300 }),
      async (job) => {
        await vt.until(284_000);
        if (await job.stillRunning()) {
          await vt.until(290_000);
          wroteAt = vt.now();
          abortedWhileWriting = job.signal.aborted;
        }
        return { headline: "Linen day" };
      },
      deps,
    );
    await vt.advanceTo(400_000);
    const out = await pending;

    expect(wroteAt).toBe(290_000);
    expect(abortedWhileWriting).toBe(false);
    expect(out).toEqual({
      status: "done",
      jobId: store.rows[0].id,
      value: { headline: "Linen day" },
      replayed: false,
    });
    expect(store.rows[0]).toMatchObject({
      status: "succeeded",
      credit_state: "charged",
      result: { headline: "Linen day" },
    });
    expect(store.calls.refunds).toBe(0);
    expect(store.balance(USER).daily).toBe(0);
  });

  test("a write still running at 300 s is failed and refunded once", async () => {
    const { vt, store, deps } = clocked();
    let signal: AbortSignal | null = null;

    const pending = withGenerationJob(
      renderSpec({ deadlineSeconds: 300 }),
      async (job) => {
        signal = job.signal;
        await vt.until(284_000);
        if (await job.stillRunning()) await vt.until(310_000);
        return { imageDataUri: JPEG_DATA_URI, mode: "render" as const };
      },
      deps,
    );

    await vt.advanceTo(290_000);
    const live = signal as AbortSignal | null;
    expect(store.rows[0].status).toBe("running");
    expect(live?.aborted).toBe(false);

    await vt.advanceTo(300_000);
    expect(store.rows[0]).toMatchObject({
      status: "failed",
      error_code: "deadline_exceeded",
      credit_state: "refunded",
    });
    expect(live?.aborted).toBe(true);

    await vt.advanceTo(400_000);
    const out = await pending;
    expect(out.status === "done" && out.value.reason).toBe("deadline_exceeded");
    expect(store.calls.refunds).toBe(1);
    expect(store.calls.complete).toBe(0);
    expect(store.balance(USER).daily).toBe(1);
  });

  test("without a write the wrapper said yes to, the job is failed at the deadline, not after a grace", async () => {
    const { vt, store, deps } = clocked();

    const pending = withGenerationJob(
      renderSpec({ deadlineSeconds: 300 }),
      async () => {
        await vt.until(400_000);
        return { imageDataUri: JPEG_DATA_URI, mode: "render" as const };
      },
      deps,
    );

    await vt.advanceTo(284_999);
    expect(store.rows[0].status).toBe("running");
    await vt.advanceTo(285_000);
    expect(store.rows[0]).toMatchObject({ status: "failed", credit_state: "refunded" });
    await vt.advanceTo(400_000);
    await pending;
    expect(store.calls.refunds).toBe(1);
  });

  test("a fresh check made during the grace answers false: only the write confirmed before the deadline gets it", async () => {
    const { vt, store, deps } = clocked();
    const answers: { at: number; live: boolean }[] = [];

    const pending = withGenerationJob(
      lookSpec({ deadlineSeconds: 300 }),
      async (job) => {
        await vt.until(284_000);
        answers.push({ at: vt.now(), live: await job.stillRunning() });
        await vt.until(294_900);
        answers.push({ at: vt.now(), live: await job.stillRunning() });
        return { headline: "Linen day" };
      },
      deps,
    );
    await vt.advanceTo(400_000);
    const out = await pending;

    expect(answers).toEqual([
      { at: 284_000, live: true },
      { at: 294_900, live: false },
    ]);
    // The write confirmed at 284 s still finished inside its grace.
    expect(out.status === "done" && out.jobId).toBe(store.rows[0].id);
    expect(store.rows[0]).toMatchObject({ status: "succeeded", credit_state: "charged" });
    expect(store.calls.refunds).toBe(0);
  });

  test("a check still reading when the deadline passes answers false and earns no grace", async () => {
    const { vt, store, deps } = clocked();
    const realGet = store.get.bind(store);
    store.get = async (jobId: string) => {
      await vt.until(285_500);
      return realGet(jobId);
    };
    let seen: boolean | null = null;

    const pending = withGenerationJob(
      renderSpec({ deadlineSeconds: 300 }),
      async (job) => {
        await vt.until(284_900);
        seen = await job.stillRunning();
        return { imageDataUri: JPEG_DATA_URI, mode: "render" as const };
      },
      deps,
    );

    await vt.advanceTo(285_100);
    expect(store.rows[0]).toMatchObject({ status: "failed", credit_state: "refunded" });
    await vt.advanceTo(400_000);
    await pending;
    expect(seen).toBe(false);
    expect(store.calls.refunds).toBe(1);
  });
});

describe("P2B-S0 fix round 1: a stored result is always jsonb-safe", () => {
  type Hunt = { identifiedAs: string; dupes: string[]; creditRefunded: boolean };

  function refundedHunt(identifiedAs: string): GenerationJobSpec<Hunt> {
    return {
      kind: "dupe_search",
      userId: USER,
      clientRequestId: REQ_A,
      input: { imageUrl: "https://example.test/look.jpg" },
      charge: true,
      dailyAllowance: 1,
      deadlineSeconds: 30,
      settle: (hunt) => ({
        ok: false,
        errorCode: "no_close_match",
        result: { ...hunt, identifiedAs },
      }),
      fromStored: ({ result }) => result as unknown as Hunt,
      failure: (_code, stored) => stored?.result as unknown as Hunt,
      legacy: async () => ({ identifiedAs: "legacy", dupes: [], creditRefunded: false }),
    };
  }

  for (const [what, raw, kept] of [
    ["a lone surrogate (an emoji cut in half)", "Linen \uD83D shirt", "Linen  shirt"],
    ["a NUL", "Linen\u0000 shirt", "Linen shirt"],
  ] as const) {
    test(`a refunded result with ${what} is failed and refunded at once, and kept without it`, async () => {
      const { store, deps } = setup(1);

      const out = await withGenerationJob(
        refundedHunt(raw),
        async () => ({ identifiedAs: "x", dupes: [], creditRefunded: true }),
        deps,
      );

      expect(out.status === "done" && out.jobId).toBe(store.rows[0].id);
      expect(store.rows[0]).toMatchObject({
        status: "failed",
        error_code: "no_close_match",
        credit_state: "refunded",
        result: { identifiedAs: kept },
      });
      expect(store.calls.refunds).toBe(1);
      expect(store.balance(USER).daily).toBe(1);
    });
  }

  test("a success result is stored jsonb-safe, emoji intact, and she gets the value as produced", async () => {
    const { store, deps } = setup(1);
    const produced = { headline: "Linen\u0000 day \uDC57 👗" };

    const out = await withGenerationJob(lookSpec(), async () => produced, deps);

    expect(out).toEqual({
      status: "done",
      jobId: store.rows[0].id,
      value: produced,
      replayed: false,
    });
    expect(store.rows[0]).toMatchObject({
      status: "succeeded",
      result: { headline: "Linen day  👗" },
    });
  });

  test("toJsonbSafe strips NUL and lone surrogates from strings and keys, keeps pairs, leaves clean values untouched", () => {
    const clean = { a: "Linen 👗", b: [1, true, null, { c: "ok" }] };
    expect(toJsonbSafe(clean)).toBe(clean);
    expect(
      toJsonbSafe({
        "k\u0000ey": ["\uD83Dx", "y\uDC57", "\uDC57\uD83D", "z\u0000"],
        n: 1,
        t: null,
        nested: { deep: "👗\uD83D" },
      }),
    ).toEqual({ key: ["x", "y", "", "z"], n: 1, t: null, nested: { deep: "👗" } });
    expect(toJsonbSafe("a\u0000b")).toBe("ab");
  });

  test("memory store refuses NUL and lone surrogates the way jsonb does", async () => {
    const store = new MemoryGenerationJobStore();
    store.seed(USER, 2);
    const a = await store.start({
      userId: USER,
      kind: "dupe_search",
      clientRequestId: REQ_A,
      input: {},
      charge: true,
      dailyAllowance: 2,
      deadlineSeconds: 30,
    });

    await expect(store.fail(a.job.id, "x", true, { s: "a\u0000" })).rejects.toThrow(
      "unsupported Unicode escape sequence",
    );
    await expect(store.fail(a.job.id, "x", true, { s: "\uD83D" })).rejects.toThrow(
      "invalid input syntax for type json",
    );
    await expect(store.complete(a.job.id, { s: "\uDC57" }, null)).rejects.toThrow(
      "invalid input syntax for type json",
    );
    expect(store.rows[0].status).toBe("running");
    expect(store.calls.refunds).toBe(0);
  });
});

describe("P2B-S0 follow-up: a delivered-but-unsaved job is never replayed as a failure", () => {
  // Honest whether she saw the result or its answer was lost (follow-up 2).
  const DELIVERED_COPY =
    "This result was made, but it couldn't be saved, so it can't be shown again. You won't be charged again for it.";

  /** One kind's spec and a produce whose value the store then fails to keep. */
  type Case = {
    kind: string;
    run: (deps: GenerationJobDeps, produce: () => Promise<void>) => Promise<unknown>;
    breakPersist: (store: MemoryGenerationJobStore) => void;
  };

  const sheet: StyleSheetPreviewResult = { imageDataUri: JPEG_DATA_URI, mode: "style_sheet" };
  const portrait: PhotoPreviewResult = { imageDataUri: JPEG_DATA_URI, mode: "photo_edit" };
  const hunt = { identifiedAs: "Linen shirt", dupes: ["a"], creditRefunded: false };

  const cases: Case[] = [
    {
      kind: "look",
      run: (deps, produced) =>
        withGenerationJob(
          lookSpec(),
          async () => {
            await produced();
            return { headline: "Linen day" };
          },
          deps,
        ),
      breakPersist: (store) => {
        store.failComplete = true;
      },
    },
    {
      kind: "style_sheet",
      run: (deps, produced) =>
        withGenerationJob<StyleSheetPreviewResult>(
          {
            kind: "style_sheet",
            userId: USER,
            clientRequestId: REQ_A,
            input: { outfit: "Linen day" },
            charge: true,
            dailyAllowance: 1,
            deadlineSeconds: 30,
            settle: styleSheetJob.settle,
            fromStored: styleSheetJob.fromStored,
            failure: styleSheetJob.failure,
            legacy: async () => sheet,
          },
          async () => {
            await produced();
            return sheet;
          },
          deps,
        ),
      breakPersist: (store) => {
        store.failUpload = true;
      },
    },
    {
      kind: "photo_preview",
      run: (deps, produced) =>
        withGenerationJob<PhotoPreviewResult>(
          {
            kind: "photo_preview",
            userId: USER,
            clientRequestId: REQ_A,
            input: { outfit: "Linen day" },
            charge: true,
            dailyAllowance: 1,
            deadlineSeconds: 30,
            settle: photoPreviewJob.settle,
            fromStored: photoPreviewJob.fromStored,
            failure: photoPreviewJob.failure,
            legacy: async () => portrait,
          },
          async () => {
            await produced();
            return portrait;
          },
          deps,
        ),
      breakPersist: (store) => {
        store.failUpload = true;
      },
    },
    {
      kind: "dupe_search",
      run: (deps, produced) =>
        withGenerationJob(
          {
            kind: "dupe_search",
            userId: USER,
            clientRequestId: REQ_A,
            input: { imageUrl: "https://example.test/look.jpg" },
            charge: true,
            dailyAllowance: 1,
            deadlineSeconds: 30,
            settle: (value) => ({ ok: true, result: value }),
            fromStored: ({ result }) => result as unknown as typeof hunt,
            failure: () => {
              throw new Error("Dupe extraction failed.");
            },
            legacy: async () => hunt,
          },
          async () => {
            await produced();
            return hunt;
          },
          deps,
        ),
      breakPersist: (store) => {
        store.failComplete = true;
      },
    },
  ];

  for (const kase of cases) {
    test(`${kase.kind}: a replay of a delivered-but-unsaved job answers DELIVERED_NOT_SAVED, with no charge and no refund`, async () => {
      const { store, deps } = setup(5);
      kase.breakPersist(store);
      const first = await kase.run(deps, async () => {});
      expect((first as { jobId: string | null }).jobId).toBeNull();
      expect(store.rows[0]).toMatchObject({
        error_code: "persist_failed_delivered",
        credit_state: "charged",
      });
      store.failComplete = false;
      store.failUpload = false;
      const before = { balance: store.balance(USER), calls: { ...store.calls } };
      let produced = 0;

      const err = await kase
        .run(deps, async () => {
          produced += 1;
        })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(GenerationDeliveredUnsavedError);
      expect((err as GenerationDeliveredUnsavedError).code).toBe("DELIVERED_NOT_SAVED");
      expect((err as GenerationDeliveredUnsavedError).jobId).toBe(store.rows[0].id);
      expect((err as Error).message).toBe(DELIVERED_COPY);
      expect(produced).toBe(0);
      expect(store.balance(USER)).toEqual(before.balance);
      expect(store.calls.refunds).toBe(before.calls.refunds);
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]).toMatchObject({
        status: "failed",
        error_code: "persist_failed_delivered",
        credit_state: "charged",
      });
    });
  }

  test("a caller attached behind a job that ends delivered-but-unsaved gets DELIVERED_NOT_SAVED, charged nothing", async () => {
    const { store, deps } = setup(5);
    store.failComplete = true;
    const gate = deferred<Look>();
    const first = withGenerationJob(lookSpec(), () => gate.promise, deps);
    await new Promise((r) => setTimeout(r, 5));
    const attached = withGenerationJob(
      lookSpec({ clientRequestId: undefined }),
      async () => ({ headline: "must not run" }),
      deps,
    ).catch((e: unknown) => e);
    setTimeout(() => gate.resolve({ headline: "Linen day" }), 10);

    const [delivered, err] = await Promise.all([first, attached]);

    // The request that produced it still gets its value, never the error.
    expect(delivered).toEqual({
      status: "done",
      jobId: null,
      value: { headline: "Linen day" },
      replayed: false,
    });
    expect(err).toBeInstanceOf(GenerationDeliveredUnsavedError);
    expect(store.balance(USER).daily).toBe(4);
    expect(store.calls.refunds).toBe(0);
  });

  test("its copy is calm, with no dashes, and its code is stable", () => {
    const err = new GenerationDeliveredUnsavedError("job-1");
    expect(err.message).toBe(DELIVERED_COPY);
    expect(err.message).not.toMatch(/[—–]/);
    expect(err.code).toBe("DELIVERED_NOT_SAVED");
    expect(err.name).toBe("GenerationDeliveredUnsavedError");
    expect(err.jobId).toBe("job-1");
    // The server error carries the client-safe constants, so a client matches it structurally.
    expect(err.code).toBe(DELIVERED_NOT_SAVED);
    expect(err.message).toBe(DELIVERED_NOT_SAVED_MESSAGE);
    expect(isDeliveredNotSaved(err)).toBe(true);
  });
});
