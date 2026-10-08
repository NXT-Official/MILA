import { describe, expect, mock, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DomainValidationError } from "@/server/http/api-errors";
import { InsufficientCreditsError } from "./credits";
import {
  GenerationImageExistsError,
  GenerationJobStoreError,
  GenerationJobsUnavailableError,
  createAvailabilityCache,
  createSupabaseGenerationJobStore,
  withGenerationJob,
} from "./generation-jobs.server";

/**
 * The Supabase adapter run through the REAL supabase-js client (the installed
 * 2.110.0), with only `fetch` stubbed. The stub answers what PostgREST and
 * Storage answer on the wire, so the adapter's request shape, `.single()` on a
 * table-returning function, the nested composite `job`, scalar returns and the
 * error bodies are all exercised exactly as in production.
 */

const URL_BASE = "http://stub.supabase.test";
const USER = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
const JOB_ID = "11111111-2222-4333-8444-555555555555";
const REQ = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const JOB_ROW = {
  id: JOB_ID,
  user_id: USER,
  kind: "look",
  client_request_id: REQ,
  status: "running",
  credit_state: "charged",
  charged_from: "daily",
  input: { vibe: "Work" },
  result: null,
  image_path: null,
  error_code: null,
  deadline_at: "2026-10-07T12:05:00+00:00",
  created_at: "2026-10-07T12:00:00+00:00",
  completed_at: null,
  refund_applied_at: null,
};

type Recorded = { method: string; url: string; headers: Headers; body: unknown };
type Reply = { status: number; body: unknown; contentType?: string };

/** PostgREST answers a table-returning function as an array, or as the one
 * object when the client asks for `application/vnd.pgrst.object+json`. */
function rows(list: unknown[]): (req: Recorded) => Reply {
  return (req) => {
    const wantsObject = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
    if (!wantsObject) return { status: 200, body: list };
    if (list.length !== 1) {
      return {
        status: 406,
        body: {
          code: "PGRST116",
          details: `The result contains ${list.length} rows`,
          hint: null,
          message: "JSON object requested, multiple (or no) rows returned",
        },
      };
    }
    return { status: 200, body: list[0] };
  };
}

function pgError(status: number, code: string, message: string): () => Reply {
  return () => ({ status, body: { code, details: null, hint: null, message } });
}

function stubClient(routes: Record<string, (req: Recorded) => Reply>) {
  const requests: Recorded[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const raw = await request.text();
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    const recorded: Recorded = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    };
    requests.push(recorded);
    const path = new URL(request.url).pathname;
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    if (!key) return new Response(`no stub for ${request.method} ${path}`, { status: 599 });
    const reply = routes[key](recorded);
    if (reply.body instanceof Uint8Array) {
      return new Response(reply.body, {
        status: reply.status,
        headers: { "content-type": reply.contentType ?? "application/octet-stream" },
      });
    }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": reply.contentType ?? "application/json" },
    });
  };
  const client = createClient<Database>(URL_BASE, "service-role-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub as typeof fetch },
  });
  const store = createSupabaseGenerationJobStore(async () => client);
  return { store, requests };
}

const START_ARGS = {
  userId: USER,
  kind: "look" as const,
  clientRequestId: REQ,
  input: { vibe: "Work" },
  charge: true,
  dailyAllowance: 3,
  deadlineSeconds: 300,
};

describe("supabase generation job store: RPC shapes", () => {
  test("start sends exactly the migration's argument names and parses { outcome, job }", async () => {
    const { store, requests } = stubClient({
      "/rest/v1/rpc/start_generation_job": rows([{ outcome: "started", job: JOB_ROW }]),
    });

    const out = await store.start(START_ARGS);

    expect(out.outcome).toBe("started");
    expect(out.job.id).toBe(JOB_ID);
    expect(out.job.status).toBe("running");
    expect(out.job.input).toEqual({ vibe: "Work" });
    expect(requests[0].method).toBe("POST");
    expect(requests[0].body).toEqual({
      p_user_id: USER,
      p_kind: "look",
      p_client_request_id: REQ,
      p_input: { vibe: "Work" },
      p_charge: true,
      p_daily_allowance: 3,
      p_deadline_seconds: 300,
    });
  });

  test("start rounds a fractional deadline up to whole seconds (the SQL takes an integer)", async () => {
    const { store, requests } = stubClient({
      "/rest/v1/rpc/start_generation_job": rows([{ outcome: "started", job: JOB_ROW }]),
    });
    await store.start({ ...START_ARGS, deadlineSeconds: 299.2 });
    expect((requests[0].body as { p_deadline_seconds: number }).p_deadline_seconds).toBe(300);
  });

  test("start answers existing and in_flight unchanged", async () => {
    for (const outcome of ["existing", "in_flight"] as const) {
      const { store } = stubClient({
        "/rest/v1/rpc/start_generation_job": rows([{ outcome, job: JOB_ROW }]),
      });
      expect((await store.start(START_ARGS)).outcome).toBe(outcome);
    }
  });

  test("an unknown start shape is a calm store error, never a crash", async () => {
    const { store } = stubClient({
      "/rest/v1/rpc/start_generation_job": rows([{ result: "??" }]),
    });
    const err = await store.start(START_ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerationJobStoreError);
  });

  test("complete sends p_image_path as an explicit null and parses both outcomes", async () => {
    const done = { ...JOB_ROW, status: "succeeded", completed_at: "2026-10-07T12:01:00+00:00" };
    const { store, requests } = stubClient({
      "/rest/v1/rpc/complete_generation_job": rows([{ outcome: "completed", job: done }]),
    });

    const out = await store.complete(JOB_ID, { headline: "H" }, null);

    expect(out).toEqual({ outcome: "completed", job: expect.objectContaining({ id: JOB_ID }) });
    expect(requests[0].body).toEqual({
      p_job_id: JOB_ID,
      p_result: { headline: "H" },
      p_image_path: null,
    });
    expect(Object.hasOwn(requests[0].body as object, "p_image_path")).toBe(true);

    const notRunning = stubClient({
      "/rest/v1/rpc/complete_generation_job": rows([{ outcome: "not_running", job: done }]),
    });
    expect((await notRunning.store.complete(JOB_ID, {}, `${USER}/${JOB_ID}.jpg`)).outcome).toBe(
      "not_running",
    );
  });

  test("fail sends the refund flag both ways and parses failed / not_running", async () => {
    const failed = { ...JOB_ROW, status: "failed", error_code: "x", completed_at: "t" };
    const { store, requests } = stubClient({
      "/rest/v1/rpc/fail_generation_job": rows([{ outcome: "failed", job: failed }]),
    });

    expect((await store.fail(JOB_ID, "persist_failed_delivered", false)).outcome).toBe("failed");
    expect(requests[0].body).toEqual({
      p_job_id: JOB_ID,
      p_error_code: "persist_failed_delivered",
      p_refund: false,
    });
    await store.fail(JOB_ID, "AiUnavailableError", true);
    expect((requests[1].body as { p_refund: boolean }).p_refund).toBe(true);

    const notRunning = stubClient({
      "/rest/v1/rpc/fail_generation_job": rows([{ outcome: "not_running", job: failed }]),
    });
    expect((await notRunning.store.fail(JOB_ID, "x", true)).outcome).toBe("not_running");
  });

  test("reap sends p_user_id for one member, nothing for everyone, and reads the integer", async () => {
    const { store, requests } = stubClient({
      "/rest/v1/rpc/reap_generation_jobs": () => ({ status: 200, body: 3 }),
    });

    expect(await store.reap(USER)).toBe(3);
    expect(requests[0].body).toEqual({ p_user_id: USER });
    expect(await store.reap(null)).toBe(3);
    expect(requests[1].body).toEqual({});
  });

  test("get reads one row without re-reading its input, or null when there is none", async () => {
    const { store, requests } = stubClient({
      "/rest/v1/generation_jobs": (req) =>
        new URL(req.url).searchParams.get("id") === `eq.${JOB_ID}`
          ? rows([{ ...JOB_ROW, input: undefined }])(req)
          : rows([])(req),
    });

    const row = await store.get(JOB_ID);
    expect(row?.id).toBe(JOB_ID);
    expect(row?.input).toBeNull();
    const select = new URL(requests[0].url).searchParams.get("select") ?? "";
    expect(select.split(",")).not.toContain("input");
    expect(select.split(",")).toEqual(
      expect.arrayContaining(["id", "status", "result", "image_path", "error_code", "deadline_at"]),
    );

    expect(await store.get("99999999-2222-4333-8444-555555555555")).toBeNull();
  });
});

describe("supabase generation job store: error shapes", () => {
  test("PGRST202 (function not in the schema cache) means the migration is missing", async () => {
    const { store } = stubClient({
      "/rest/v1/rpc/start_generation_job": pgError(
        404,
        "PGRST202",
        "Could not find the function public.start_generation_job(p_charge, p_client_request_id, p_daily_allowance, p_deadline_seconds, p_input, p_kind, p_user_id) in the schema cache",
      ),
    });
    expect(await store.start(START_ARGS).catch((e: unknown) => e)).toBeInstanceOf(
      GenerationJobsUnavailableError,
    );
  });

  test("42P01 and PGRST205 on the table mean the migration is missing", async () => {
    for (const [code, message] of [
      ["42P01", 'relation "public.generation_jobs" does not exist'],
      ["PGRST205", "Could not find the table 'public.generation_jobs' in the schema cache"],
    ] as const) {
      const { store } = stubClient({ "/rest/v1/generation_jobs": pgError(404, code, message) });
      expect(await store.get(JOB_ID).catch((e: unknown) => e)).toBeInstanceOf(
        GenerationJobsUnavailableError,
      );
    }
  });

  test("P0001 invalid_generation_kind is a calm store error, NOT a missing migration", async () => {
    const { store } = stubClient({
      "/rest/v1/rpc/start_generation_job": pgError(400, "P0001", "invalid_generation_kind"),
    });
    const err = await store.start(START_ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerationJobStoreError);
    expect(err).not.toBeInstanceOf(GenerationJobsUnavailableError);
    expect((err as Error).message).not.toContain("invalid_generation_kind");
  });

  test("P0001 insufficient_credits and client_request_id_conflict map to the existing errors", async () => {
    const credits = stubClient({
      "/rest/v1/rpc/start_generation_job": pgError(400, "P0001", "insufficient_credits"),
    });
    expect(await credits.store.start(START_ARGS).catch((e: unknown) => e)).toBeInstanceOf(
      InsufficientCreditsError,
    );
    const conflict = stubClient({
      "/rest/v1/rpc/start_generation_job": pgError(400, "P0001", "client_request_id_conflict"),
    });
    expect(await conflict.store.start(START_ARGS).catch((e: unknown) => e)).toBeInstanceOf(
      DomainValidationError,
    );
  });

  test("a PostgREST outage (5xx) is never read as a missing migration", async () => {
    const { store } = stubClient({
      "/rest/v1/rpc/reap_generation_jobs": pgError(503, "PGRST001", "Database client error"),
    });
    const err = await store.reap(USER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerationJobStoreError);
  });

  test("the wrapper falls back to the legacy path on a real PGRST202 answer", async () => {
    const { store } = stubClient({
      "/rest/v1/rpc/reap_generation_jobs": pgError(
        404,
        "PGRST202",
        "Could not find the function public.reap_generation_jobs(p_user_id) in the schema cache",
      ),
    });
    const legacy = mock(async () => ({ headline: "legacy" }));
    const produce = mock(async () => ({ headline: "job" }));

    const out = await withGenerationJob(
      {
        kind: "look",
        userId: USER,
        clientRequestId: REQ,
        input: {},
        charge: true,
        dailyAllowance: 1,
        deadlineSeconds: 300,
        settle: (v) => ({ ok: true, result: v }),
        fromStored: () => ({ headline: "stored" }),
        failure: () => ({ headline: "failed" }),
        legacy,
      },
      produce,
      { store, availability: createAvailabilityCache(60_000) },
    );

    expect(out).toEqual({
      status: "done",
      jobId: null,
      value: { headline: "legacy" },
      replayed: false,
    });
    expect(produce).not.toHaveBeenCalled();
  });
});

describe("supabase generation job store: the generations bucket", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const PATH = `${USER}/${JOB_ID}.jpg`;

  test("upload goes to generations/<uid>/<jobId>.jpg with its content type, never upserting", async () => {
    const { store, requests } = stubClient({
      [`/storage/v1/object/generations/${PATH}`]: () => ({
        status: 200,
        body: { Key: `generations/${PATH}`, Id: "obj-1" },
      }),
    });

    await store.uploadImage(PATH, JPEG, "image/jpeg");

    const upload = requests[0];
    expect(upload.method).toBe("POST");
    expect(new URL(upload.url).pathname).toBe(`/storage/v1/object/generations/${PATH}`);
    expect(upload.headers.get("content-type")).toBe("image/jpeg");
    expect(upload.headers.get("x-upsert")).toBe("false");
  });

  test("an upload onto an existing object is reported as already stored", async () => {
    const { store } = stubClient({
      [`/storage/v1/object/generations/${PATH}`]: () => ({
        status: 409,
        body: { statusCode: "409", error: "Duplicate", message: "The resource already exists" },
      }),
    });
    expect(
      await store.uploadImage(PATH, JPEG, "image/jpeg").catch((e: unknown) => e),
    ).toBeInstanceOf(GenerationImageExistsError);
  });

  test("any other upload failure is a calm store error", async () => {
    const { store } = stubClient({
      [`/storage/v1/object/generations/${PATH}`]: () => ({
        status: 500,
        body: { statusCode: "500", error: "Internal", message: "storage backend down" },
      }),
    });
    const err = await store.uploadImage(PATH, JPEG, "image/jpeg").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerationJobStoreError);
    expect(err).not.toBeInstanceOf(GenerationImageExistsError);
  });

  test("download reads the stored bytes and type back", async () => {
    const { store } = stubClient({
      "/storage/v1/object/": (req) =>
        new URL(req.url).pathname.endsWith(`/generations/${PATH}`)
          ? { status: 200, body: JPEG, contentType: "image/jpeg" }
          : {
              status: 404,
              body: { statusCode: "404", error: "not_found", message: "Object not found" },
            },
    });

    const image = await store.downloadImage(PATH);
    expect(image.bytes).toEqual(JPEG);
    expect(image.contentType).toBe("image/jpeg");
  });
});

describe("members cannot write into generations/ (storage policy pin)", () => {
  const migrationsDir = join(import.meta.dir, "../../supabase/migrations");
  const sql = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n");
  const storagePolicies = (sql.match(/create\s+policy[\s\S]*?;/gi) ?? []).filter((statement) =>
    /on\s+storage\.objects/i.test(statement),
  );

  test("the generations bucket is private", () => {
    // 20261007143000_generation_jobs.sql:256-258
    expect(sql).toMatch(/VALUES \('generations', 'generations', false,/);
  });

  test("its only member policy is SELECT on her own folder", () => {
    // 20261007143000_generation_jobs.sql:270-275
    const generations = storagePolicies.filter((statement) =>
      /bucket_id\s*=\s*'generations'/i.test(statement),
    );
    expect(generations).toHaveLength(1);
    expect(generations[0]).toMatch(/FOR SELECT TO authenticated/i);
    expect(generations[0]).toMatch(
      /\(storage\.foldername\(name\)\)\[1\]\s*=\s*\(select auth\.uid\(\)\)::text/i,
    );
  });

  test("every write policy on storage.objects names a bucket, and none is generations", () => {
    const writes = storagePolicies.filter(
      (statement) =>
        /for\s+(insert|update|delete|all)\b/i.test(statement) || !/for\s+select\b/i.test(statement), // no FOR clause = ALL
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const statement of writes) {
      const bucket = /bucket_id\s*=\s*'([^']+)'/i.exec(statement)?.[1];
      expect(bucket).toBeDefined();
      expect(bucket).not.toBe("generations");
    }
  });

  test("the object name carries a server-minted job id (gen_random_uuid), never client input", () => {
    // 20261007143000_generation_jobs.sql:156
    expect(sql).toMatch(
      /generation_jobs \([\s\S]*?id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/,
    );
  });
});

describe("supabase generation job store: a refunded result is kept (P2B-S0)", () => {
  const HUNT = { identifiedAs: "Linen shirt", dupes: [], creditRefunded: true };
  const WITH_RESULT = "/rest/v1/rpc/fail_generation_job_with_result";
  const PLAIN_FAIL = "/rest/v1/rpc/fail_generation_job";
  const KEPT = {
    ...JOB_ROW,
    kind: "dupe_search",
    status: "failed",
    error_code: "no_close_match",
    credit_state: "refunded",
    result: HUNT,
    completed_at: "2026-10-07T12:01:00+00:00",
  };
  const REFUNDED_WITHOUT_RESULT = { ...KEPT, result: null };
  const pathOf = (req: Recorded) => new URL(req.url).pathname;

  test("fail with a result calls fail_generation_job_with_result", async () => {
    // The longer path is listed first: the stub matches routes by prefix.
    const { store, requests } = stubClient({
      [WITH_RESULT]: rows([{ outcome: "failed", job: KEPT }]),
      [PLAIN_FAIL]: rows([{ outcome: "failed", job: REFUNDED_WITHOUT_RESULT }]),
    });

    const out = await store.fail(JOB_ID, "no_close_match", true, HUNT);

    expect(out.outcome).toBe("failed");
    expect(out.job.result).toEqual(HUNT);
    expect(requests.map(pathOf)).toEqual([WITH_RESULT]);
    expect(requests[0].body).toEqual({
      p_job_id: JOB_ID,
      p_error_code: "no_close_match",
      p_refund: true,
      p_result: HUNT,
    });

    // Without a result (or with null) the call is today's fail_generation_job, unchanged.
    await store.fail(JOB_ID, "AiUnavailableError", true);
    await store.fail(JOB_ID, "AiUnavailableError", true, null);
    expect(requests.slice(1).map(pathOf)).toEqual([PLAIN_FAIL, PLAIN_FAIL]);
    expect(requests[2].body).toEqual({
      p_job_id: JOB_ID,
      p_error_code: "AiUnavailableError",
      p_refund: true,
    });
  });

  test("when that function is missing it falls back to fail_generation_job, still refunds once, and generation jobs stay available", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const [status, code, message] of [
        [
          404,
          "PGRST202",
          "Could not find the function public.fail_generation_job_with_result(p_error_code, p_job_id, p_refund, p_result) in the schema cache",
        ],
        [
          404,
          "42883",
          "function public.fail_generation_job_with_result(uuid, text, boolean, jsonb) does not exist",
        ],
      ] as const) {
        warn.mockClear();
        const { store, requests } = stubClient({
          [WITH_RESULT]: pgError(status, code, message),
          [PLAIN_FAIL]: rows([{ outcome: "failed", job: REFUNDED_WITHOUT_RESULT }]),
        });

        const out = await store.fail(JOB_ID, "no_close_match", true, HUNT);

        // A calm fail, never GenerationJobsUnavailableError: jobs stay on.
        expect(out.outcome).toBe("failed");
        expect(out.job.credit_state).toBe("refunded");
        expect(requests.map(pathOf)).toEqual([WITH_RESULT, PLAIN_FAIL]);
        expect(requests[1].body).toEqual({
          p_job_id: JOB_ID,
          p_error_code: "no_close_match",
          p_refund: true,
        });

        // The miss is remembered: the next one goes straight to fail_generation_job,
        // and the warning is not repeated.
        await store.fail(JOB_ID, "no_close_match", true, HUNT);
        expect(requests.slice(2).map(pathOf)).toEqual([PLAIN_FAIL]);
        const reports = warn.mock.calls.filter((args) =>
          String(args[0]).includes("fail_generation_job_with_result"),
        );
        expect(reports).toHaveLength(1);
      }
    } finally {
      warn.mockRestore();
    }
  });

  test("a missing fail_generation_job_with_result never switches the wrapper to its legacy path", async () => {
    const started = { ...JOB_ROW, kind: "dupe_search" };
    let starts = 0;
    const { store, requests } = stubClient({
      "/rest/v1/rpc/reap_generation_jobs": () => ({ status: 200, body: 0 }),
      "/rest/v1/rpc/start_generation_job": (req) => {
        starts += 1;
        return rows([{ outcome: "started", job: started }])(req);
      },
      [WITH_RESULT]: pgError(404, "PGRST202", "Could not find the function in the schema cache"),
      [PLAIN_FAIL]: rows([{ outcome: "failed", job: REFUNDED_WITHOUT_RESULT }]),
    });
    const availability = createAvailabilityCache(60_000);
    const legacy = mock(async () => ({ ...HUNT, identifiedAs: "legacy" }));
    const spec = {
      kind: "dupe_search" as const,
      userId: USER,
      clientRequestId: REQ,
      input: { imageUrl: "https://example.test/look.jpg" },
      charge: true,
      dailyAllowance: 1,
      deadlineSeconds: 300,
      settle: (hunt: typeof HUNT) =>
        ({ ok: false, errorCode: "no_close_match", result: hunt }) as const,
      fromStored: () => HUNT,
      failure: () => HUNT,
      legacy,
    };
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = await withGenerationJob(spec, async () => HUNT, { store, availability });
      expect(out).toEqual({ status: "done", jobId: JOB_ID, value: HUNT, replayed: false });
      expect(availability.isMissing()).toBe(false);

      const next = await withGenerationJob(
        { ...spec, clientRequestId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
        async () => HUNT,
        { store, availability },
      );
      expect(next.status === "done" && next.jobId).toBe(JOB_ID);
    } finally {
      warn.mockRestore();
    }

    expect(legacy).not.toHaveBeenCalled();
    expect(starts).toBe(2);
    expect(requests.filter((req) => pathOf(req) === PLAIN_FAIL)).toHaveLength(2);
  });

  test("a result the database refuses (invalid_result) is dropped: a plain fail still refunds", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { store, requests } = stubClient({
        [WITH_RESULT]: pgError(400, "P0001", "invalid_result"),
        [PLAIN_FAIL]: rows([{ outcome: "failed", job: REFUNDED_WITHOUT_RESULT }]),
      });

      const out = await store.fail(JOB_ID, "no_close_match", true, HUNT);
      expect(out.outcome).toBe("failed");
      expect(out.job.credit_state).toBe("refunded");
      expect(requests.map(pathOf)).toEqual([WITH_RESULT, PLAIN_FAIL]);
      expect((requests[1].body as { p_refund: boolean }).p_refund).toBe(true);

      // Not a missing function: the next result is offered to the database again.
      await store.fail(JOB_ID, "no_close_match", true, HUNT);
      expect(requests.slice(2).map(pathOf)).toEqual([WITH_RESULT, PLAIN_FAIL]);
    } finally {
      error.mockRestore();
    }
  });

  test("any other error from fail_generation_job_with_result is a calm store error once the plain fail after it fails too", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { store, requests } = stubClient({
        [WITH_RESULT]: pgError(503, "PGRST001", "Database client error"),
        [PLAIN_FAIL]: pgError(503, "PGRST001", "Database client error"),
      });
      const err = await store.fail(JOB_ID, "no_close_match", true, HUNT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GenerationJobStoreError);
      expect(err).not.toBeInstanceOf(GenerationJobsUnavailableError);
      expect(requests.map(pathOf)).toEqual([WITH_RESULT, PLAIN_FAIL]);
    } finally {
      error.mockRestore();
    }
  });

  test("any error but a missing function falls back to a plain fail that refunds at once (fix round 1)", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const [what, answer] of [
        [
          "22P02 lone surrogate",
          pgError(
            400,
            "22P02",
            "invalid input syntax for type json: Unicode low surrogate must follow a high surrogate.",
          ),
        ],
        ["22P05 NUL", pgError(400, "22P05", "unsupported Unicode escape sequence")],
        ["a PostgREST outage", pgError(503, "PGRST001", "Database client error")],
        [
          "a lost connection",
          () => {
            throw new TypeError("fetch failed");
          },
        ],
      ] as const) {
        const { store, requests } = stubClient({
          [WITH_RESULT]: answer,
          [PLAIN_FAIL]: rows([{ outcome: "failed", job: REFUNDED_WITHOUT_RESULT }]),
        });

        const out = await store.fail(JOB_ID, "no_close_match", true, HUNT);

        expect({ what, outcome: out.outcome, credit: out.job.credit_state }).toEqual({
          what,
          outcome: "failed",
          credit: "refunded",
        });
        expect(requests.map(pathOf)).toEqual([WITH_RESULT, PLAIN_FAIL]);
        expect(requests[1].body).toEqual({
          p_job_id: JOB_ID,
          p_error_code: "no_close_match",
          p_refund: true,
        });

        // Not a missing function: the next result is offered to the database again.
        await store.fail(JOB_ID, "no_close_match", true, HUNT);
        expect(requests.slice(2).map(pathOf)).toEqual([WITH_RESULT, PLAIN_FAIL]);
      }
    } finally {
      error.mockRestore();
    }
  });
});

describe("fail_generation_job_with_result migration (P2B-S0)", () => {
  const file = readdirSync(join(import.meta.dir, "../../supabase/migrations")).find((name) =>
    name.endsWith("_generation_job_fail_with_result.sql"),
  );
  const sql = file
    ? readFileSync(join(import.meta.dir, "../../supabase/migrations", file), "utf8")
    : "";

  test("is additive: it creates one function and drops, deletes or alters nothing", () => {
    expect(file).toBeDefined();
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fail_generation_job_with_result\(/);
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|ALTER\s+TABLE|DELETE\s+FROM)\b/i);
  });

  test("only service_role may execute it, and it runs with an empty search_path", () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fail_generation_job_with_result\(UUID, TEXT, BOOLEAN, JSONB\)\s+FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fail_generation_job_with_result\(UUID, TEXT, BOOLEAN, JSONB\)\s+TO service_role;/,
    );
    expect(sql).toMatch(/SECURITY DEFINER SET search_path = ''/);
  });

  test("writes the result only on running -> failed, and refunds through the exactly-once helper", () => {
    expect(sql).toMatch(/WHERE j\.id = p_job_id AND j\.status = 'running'/);
    expect(sql).toMatch(/PERFORM public\.refund_generation_job_credit\(p_job_id\)/);
    expect(sql).toMatch(/octet_length\(p_result::text\) > 65536/);
  });
});
