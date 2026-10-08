import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { reapGenerationJobs } from "@/lib/generation-jobs.server";
import { consumeRateLimit } from "@/lib/rate-limit.server";
import { respondWithError } from "@/server/http/respond";

export type HandleGenerationJobsReapDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  consumeRateLimit: typeof consumeRateLimit;
  reapGenerationJobs: typeof reapGenerationJobs;
};

const defaultDeps: HandleGenerationJobsReapDeps = {
  verifyBearerAuth,
  consumeRateLimit,
  reapGenerationJobs,
};

/**
 * `POST /api/v1/generation-jobs/reap` mirrors `reapMyGenerationJobs` in
 * `src/lib/generation-jobs.functions.ts`. The app calls it when it finds one
 * of her generation jobs stuck in `running` past its deadline, so the credit
 * comes back within seconds. Answers `200 { available, reaped }`;
 * `available: false, reaped: 0` while the generation_jobs migration is not
 * applied. It reaps only the caller's own jobs: her id comes from the bearer
 * token and the body is never read. 30 per 10 minutes.
 */
export async function handleGenerationJobsReap(
  request: Request,
  deps: HandleGenerationJobsReapDeps = defaultDeps,
): Promise<Response> {
  try {
    const { userId } = await deps.verifyBearerAuth(request);
    await deps.consumeRateLimit(`generation-jobs:reap:${userId}`, {
      limit: 30,
      windowSeconds: 600,
    });
    return Response.json(await deps.reapGenerationJobs(userId));
  } catch (error) {
    return respondWithError("generation-jobs/reap", error);
  }
}

export const Route = createFileRoute("/api/v1/generation-jobs/reap")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGenerationJobsReap(request),
    },
  },
});
