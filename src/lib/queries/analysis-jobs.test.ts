import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { memberQueryRetry } from "./member-query";
import {
  ANALYSIS_JOB_COLUMNS,
  ANALYSIS_JOB_KINDS,
  latestAnalysisJobQueryOptions,
  parseAnalysisJobRow,
  type AnalysisJobState,
} from "./analysis-jobs";
import { fakeMemberSession } from "../../../tests/helpers/fake-member-supabase";

const USER = "user-1";
const TOKEN = "member-token";

type Result = { data?: unknown; error?: { code?: string; message: string } | null };

/** Records every builder call and answers the awaited chain with `result`. */
function fakeClient(result: Result, session = fakeMemberSession(USER, TOKEN)) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "setHeader"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(
      resolve,
      reject,
    );
  const client = {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
  };
  return { client: client as never, calls };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    kind: "check_in",
    client_request_id: "6f1c2d4e-0000-4000-8000-000000000001",
    status: "succeeded",
    credit_state: "none",
    result: { skinDepth: "Medium", hairColor: "Auburn" },
    error_code: null,
    deadline_at: "2026-10-07T11:05:00.000000+00:00",
    created_at: "2026-10-07T11:00:00.000000+00:00",
    completed_at: "2026-10-07T11:01:00.000000+00:00",
    ...overrides,
  };
}

async function fetchState(client: never, kind: (typeof ANALYSIS_JOB_KINDS)[number] = "check_in") {
  const queryClient = new QueryClient();
  const options = latestAnalysisJobQueryOptions(USER, kind, client);
  const state = (await queryClient.fetchQuery({ ...options, retry: false })) as AnalysisJobState;
  queryClient.clear();
  return state;
}

describe("ANALYSIS_JOB_KINDS", () => {
  test("are the three Wave D reads", () => {
    expect([...ANALYSIS_JOB_KINDS]).toEqual(["color_read", "check_in", "body_scan"]);
  });
});

describe("latestAnalysisJobQueryOptions", () => {
  test("reads one kind, newest first, as her", async () => {
    const { client, calls } = fakeClient({ data: [row()] });
    const state = await fetchState(client, "check_in");

    expect(calls[0]).toEqual(["from", "generation_jobs"]);
    expect(calls).toContainEqual(["select", ANALYSIS_JOB_COLUMNS]);
    expect(ANALYSIS_JOB_COLUMNS).toBe(
      "id,kind,client_request_id,status,credit_state,result,error_code,deadline_at,created_at,completed_at",
    );
    expect(calls).toContainEqual(["eq", "user_id", USER]);
    expect(calls).toContainEqual(["eq", "kind", "check_in"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 1]);
    expect(calls).toContainEqual(["setHeader", "Authorization", `Bearer ${TOKEN}`]);

    expect(state).toEqual({
      status: "ready",
      job: {
        id: "job-1",
        kind: "check_in",
        clientRequestId: "6f1c2d4e-0000-4000-8000-000000000001",
        status: "succeeded",
        creditState: "none",
        result: { skinDepth: "Medium", hairColor: "Auburn" },
        errorCode: null,
        deadlineAt: "2026-10-07T11:05:00.000000+00:00",
        createdAt: "2026-10-07T11:00:00.000000+00:00",
        completedAt: "2026-10-07T11:01:00.000000+00:00",
      },
    });
  });

  test("uses its own query key per kind and the member retry policy", () => {
    const { client } = fakeClient({ data: [] });
    const options = latestAnalysisJobQueryOptions(USER, "body_scan", client);
    expect(options.queryKey).toEqual(queryKeys.analysisJob(USER, "body_scan"));
    expect(options.retry).toBe(memberQueryRetry);
  });

  test("no row yet reads as ready with no job", async () => {
    const { client } = fakeClient({ data: [] });
    expect(await fetchState(client)).toEqual({ status: "ready", job: null });
  });

  test("polls every 3 seconds only while her job is running", () => {
    const { client } = fakeClient({ data: [] });
    const options = latestAnalysisJobQueryOptions(USER, "check_in", client);
    const interval = options.refetchInterval as (query: { state: { data: unknown } }) => unknown;
    const running = parseAnalysisJobRow(row({ status: "running", completed_at: null }));
    expect(interval({ state: { data: { status: "ready", job: running } } })).toBe(3_000);
    expect(
      interval({ state: { data: { status: "ready", job: parseAnalysisJobRow(row()) } } }),
    ).toBe(false);
    expect(interval({ state: { data: { status: "unavailable" } } })).toBe(false);
    expect(interval({ state: { data: undefined } })).toBe(false);
  });

  test("a failing read that is not a missing table throws, so the last good row stays", async () => {
    const { client } = fakeClient({ error: { code: "PGRST301", message: "JWT expired" } });
    await expect(fetchState(client)).rejects.toMatchObject({ code: "PGRST301" });
  });
});

describe("analysis jobs", () => {
  test("a missing generation_jobs table reads as unavailable", async () => {
    for (const code of ["PGRST205", "42P01", "42703"]) {
      const { client } = fakeClient({ error: { code, message: "missing" } });
      expect(await fetchState(client)).toEqual({ status: "unavailable" });
    }
  });
});

describe("parseAnalysisJobRow", () => {
  test("skips other kinds and unknown statuses", () => {
    expect(parseAnalysisJobRow(row({ kind: "look" }))).toBeNull();
    expect(parseAnalysisJobRow(row({ kind: "style_sheet" }))).toBeNull();
    expect(parseAnalysisJobRow(row({ status: "queued" }))).toBeNull();
    expect(parseAnalysisJobRow(row({ status: null }))).toBeNull();
    for (const kind of ANALYSIS_JOB_KINDS) {
      expect(parseAnalysisJobRow(row({ kind }))?.kind).toBe(kind);
    }
    for (const status of ["running", "succeeded", "failed"]) {
      expect(parseAnalysisJobRow(row({ status }))?.status).toBe(status as never);
    }
  });

  test("skips a row missing its id, request id or times", () => {
    for (const key of ["id", "client_request_id", "deadline_at", "created_at"]) {
      expect(parseAnalysisJobRow(row({ [key]: null }))).toBeNull();
    }
    for (const value of [null, undefined, "row", [], 3]) {
      expect(parseAnalysisJobRow(value)).toBeNull();
    }
  });

  test("an unknown credit state reads as none; a missing result or error reads as null", () => {
    const parsed = parseAnalysisJobRow(
      row({ credit_state: "weird", result: undefined, error_code: "" }),
    );
    expect(parsed?.creditState).toBe("none");
    expect(parsed?.result).toBeNull();
    expect(parsed?.errorCode).toBeNull();
  });

  test("never carries a photo or the job input", () => {
    const parsed = parseAnalysisJobRow(
      row({ input: { photos: ["face"], digest: "abc" }, image_path: "u/j.jpg" }),
    );
    expect(parsed).not.toHaveProperty("input");
    expect(parsed).not.toHaveProperty("imagePath");
  });
});
