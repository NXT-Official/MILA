import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { reapGenerationJobs } from "./generation-jobs.server";

/**
 * Fails and refunds the signed-in member's own generation jobs that are still
 * "running" 30 s past their deadline (their server was ended mid-generation).
 * A client calls this when it finds a job row stuck in `running`, so the
 * credit comes back without waiting for the next generation or the daily
 * cron. Answers `{ available, reaped }`; `available: false` until the
 * generation_jobs migration is applied. Only ever touches the caller's jobs.
 */
export const reapMyGenerationJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ available: boolean; reaped: number }> =>
    reapGenerationJobs(context.userId),
  );
