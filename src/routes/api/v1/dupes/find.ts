import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { Input as FindDupesInput } from "@/lib/dupe-hunter.functions";
import { findDupesForUser } from "@/server/services/dupes";

export type HandleDupesFindDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  findDupesForUser: typeof findDupesForUser;
};

const defaultDeps: HandleDupesFindDeps = { verifyBearerAuth, findDupesForUser };

/**
 * `POST /api/v1/dupes/find` — mirrors `findDupes` in
 * `src/lib/dupe-hunter.functions.ts`. **1 AI credit**, 15/hour, and a vision
 * call. The `imageUrl` must already be a Mila storage URL (SSRF defence, §8).
 * See `MILA_MOBILE/src/services/api/items.ts`.
 *
 * Generation jobs: an optional `clientRequestId` (UUID) makes the hunt
 * replayable without a second charge, and while another hunt of hers is
 * running the answer is `{ status: 'running', jobId }`. Without it the call
 * is exactly today's and waits for the hunt.
 */
export async function handleDupesFind(
  request: Request,
  deps: HandleDupesFindDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = FindDupesInput.parse(body);

    // A client that sends a request id handles the `running` answer; the rest
    // wait for the hunt, as before (the service attaches by default).
    const result = input.clientRequestId
      ? await deps.findDupesForUser(supabase, userId, input, undefined, { inFlight: "report" })
      : await deps.findDupesForUser(supabase, userId, input);
    return Response.json(result);
  } catch (error) {
    return respondWithError("dupes/find", error);
  }
}

export const Route = createFileRoute("/api/v1/dupes/find")({
  server: {
    handlers: {
      POST: async ({ request }) => handleDupesFind(request),
    },
  },
});
