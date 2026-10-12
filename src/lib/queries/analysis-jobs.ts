import { queryOptions } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { queryKeys } from "@/constants/query-keys";
import { memberAuthorization } from "@/lib/auth-session";
import { memberQueryRetry } from "@/lib/queries/member-query";
import { ANALYSIS_POLL_MS } from "@/lib/analysis-job-offer";
import { isWaveDMissing } from "@/lib/wave-d-availability";

/**
 * Her latest Wave D read job (colour read, Today's check-in, body scan), so a
 * reload or a tab switch comes back to "Still reading", then to the result
 * (Wave D plan, section 3.5). What a row means is decided by
 * `analysisJobOffer` (src/lib/analysis-job-offer.ts).
 *
 * Reads `public.generation_jobs` (20261007143000_generation_jobs.sql, RLS:
 * she reads only her own rows) with her own Authorization header. Never the
 * job's `input` or `image_path`: a read's photos are analysed in memory and
 * never stored (R-4). Until that migration is applied the table is missing
 * and every read answers `{ status: "unavailable" }`.
 *
 * Independent of the look generation queries (src/lib/queries/generation-jobs.ts).
 */

export type AnalysisJobsClient = SupabaseClient<Database>;

export const ANALYSIS_JOB_KINDS = ["color_read", "check_in", "body_scan"] as const;
export type AnalysisJobKind = (typeof ANALYSIS_JOB_KINDS)[number];

export const ANALYSIS_JOB_COLUMNS =
  "id,kind,client_request_id,status,credit_state,result,error_code,deadline_at,created_at,completed_at";

export type AnalysisJob = {
  id: string;
  kind: AnalysisJobKind;
  clientRequestId: string;
  status: "running" | "succeeded" | "failed";
  creditState: "none" | "charged" | "refunded";
  result: Json | null;
  errorCode: string | null;
  deadlineAt: string;
  createdAt: string;
  completedAt: string | null;
};

export type AnalysisJobState =
  { status: "unavailable" } | { status: "ready"; job: AnalysisJob | null };

const STATUSES: ReadonlySet<string> = new Set(["running", "succeeded", "failed"]);
const CREDIT_STATES: ReadonlySet<string> = new Set(["none", "charged", "refunded"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isAnalysisJobKind(value: unknown): value is AnalysisJobKind {
  return ANALYSIS_JOB_KINDS.includes(value as AnalysisJobKind);
}

/** A row as PostgREST returns it, checked; null for another kind or anything unexpected. */
export function parseAnalysisJobRow(raw: unknown): AnalysisJob | null {
  const row = record(raw);
  if (!row) return null;
  const id = text(row.id);
  const clientRequestId = text(row.client_request_id);
  const deadlineAt = text(row.deadline_at);
  const createdAt = text(row.created_at);
  if (!id || !clientRequestId || !deadlineAt || !createdAt) return null;
  if (!isAnalysisJobKind(row.kind)) return null;
  if (typeof row.status !== "string" || !STATUSES.has(row.status)) return null;
  const creditState =
    typeof row.credit_state === "string" && CREDIT_STATES.has(row.credit_state)
      ? (row.credit_state as AnalysisJob["creditState"])
      : "none";
  return {
    id,
    kind: row.kind,
    clientRequestId,
    status: row.status as AnalysisJob["status"],
    creditState,
    result: (row.result ?? null) as Json | null,
    errorCode: text(row.error_code),
    deadlineAt,
    createdAt,
    completedAt: text(row.completed_at),
  };
}

/** Her newest job of one kind, read as her. Polls every 3 s while it is running. */
export function latestAnalysisJobQueryOptions(
  userId: string | undefined,
  kind: AnalysisJobKind,
  client: AnalysisJobsClient = supabase,
) {
  return queryOptions({
    queryKey: queryKeys.analysisJob(userId, kind),
    queryFn: async (): Promise<AnalysisJobState> => {
      if (!userId) return { status: "ready", job: null };
      // Read as her, never as anonymous (an anonymous read sees "no job").
      const authorization = await memberAuthorization(client.auth, userId);
      const { data, error } = await client
        .from("generation_jobs")
        .select(ANALYSIS_JOB_COLUMNS)
        .eq("user_id", userId)
        .eq("kind", kind)
        .order("created_at", { ascending: false })
        .limit(1)
        .setHeader("Authorization", authorization);
      if (error) {
        if (isWaveDMissing(error)) return { status: "unavailable" };
        // Anything else throws, so React Query keeps the last good row and retries.
        throw error;
      }
      return { status: "ready", job: parseAnalysisJobRow(data?.[0] ?? null) };
    },
    staleTime: 10_000,
    retry: memberQueryRetry,
    // src: https://tanstack.com/query/v5/docs/framework/react/reference/useQuery
    //   (refetchInterval: number | false | ((query) => number | false)) · @tanstack/react-query 5.101.2
    refetchInterval: (query) => {
      const state = query.state.data;
      return state?.status === "ready" && state.job?.status === "running"
        ? ANALYSIS_POLL_MS
        : false;
    },
  });
}
