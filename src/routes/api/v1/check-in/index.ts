import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { CheckInInput, runCheckInForUser } from "@/server/services/check-in";

export type HandleCheckInDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  runCheckInForUser: typeof runCheckInForUser;
};

const defaultDeps: HandleCheckInDeps = { verifyBearerAuth, runCheckInForUser };

/**
 * `POST /api/v1/check-in` mirrors `runCheckIn` in `src/lib/check-in.functions.ts`,
 * result shape included: `{ faceImageBase64, bodyImageBase64?, clientRequestId? }`
 * answers `{ success: true, read, jobId? }`, and failures ride a **200** as
 * `{ success: false, error }` (`CHECK_IN_RATE_LIMITED`, `CHECK_IN_PHOTO_UNUSABLE`,
 * `CHECK_IN_PHOTO_TOO_LARGE`, `CHECK_IN_UNAVAILABLE`, `CHECK_IN_FAILED`,
 * `INSUFFICIENT_CREDITS`). Another check-in with other photos still being read
 * answers `429 RATE_LIMITED` with `retryAfter`. The first check-in each UTC day
 * is free, then 1 credit; 5 an hour. Photos are read in memory only.
 */
export async function handleCheckIn(
  request: Request,
  deps: HandleCheckInDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = CheckInInput.parse(body);

    const result = await deps.runCheckInForUser(supabase, userId, input);
    return Response.json(result);
  } catch (error) {
    return respondWithError("check-in", error);
  }
}

export const Route = createFileRoute("/api/v1/check-in/")({
  server: {
    handlers: {
      POST: async ({ request }) => handleCheckIn(request),
    },
  },
});
