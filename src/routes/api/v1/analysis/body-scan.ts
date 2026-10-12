import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { BodyScanInput, runBodyScanForUser } from "@/server/services/body-scan";

export type HandleAnalysisBodyScanDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  runBodyScanForUser: typeof runBodyScanForUser;
};

const defaultDeps: HandleAnalysisBodyScanDeps = { verifyBearerAuth, runBodyScanForUser };

/**
 * `POST /api/v1/analysis/body-scan` mirrors `runBodyScan` in
 * `src/lib/check-in.functions.ts`: `{ bodyImageBase64, clientRequestId? }`
 * answers `{ success: true, silhouette, jobId? }`, and failures ride a **200**
 * as `{ success: false, error }` (`BODY_SCAN_NOT_FULL_LENGTH`,
 * `BODY_SCAN_RATE_LIMITED`, `BODY_SCAN_PHOTO_TOO_LARGE`, `BODY_SCAN_UNAVAILABLE`,
 * `BODY_SCAN_FAILED`, `INSUFFICIENT_CREDITS`). Another scan of a different
 * photo still being read answers `429 RATE_LIMITED` with `retryAfter`. Her
 * founding scan is free once, then 1 credit; 10 an hour. The photo is read in
 * memory only.
 */
export async function handleAnalysisBodyScan(
  request: Request,
  deps: HandleAnalysisBodyScanDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = BodyScanInput.parse(body);

    const result = await deps.runBodyScanForUser(supabase, userId, input);
    return Response.json(result);
  } catch (error) {
    return respondWithError("analysis/body-scan", error);
  }
}

export const Route = createFileRoute("/api/v1/analysis/body-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => handleAnalysisBodyScan(request),
    },
  },
});
