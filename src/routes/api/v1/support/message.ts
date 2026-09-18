import { createFileRoute } from "@tanstack/react-router";
import { getClientIp, parseJsonBody, respondWithError } from "@/server/http/respond";
import { SubmitSupportMessageInput } from "@/lib/support.functions";
import { submitSupportMessageForIp } from "@/server/services/support";

export type HandleSupportMessageDeps = {
  submitSupportMessageForIp: typeof submitSupportMessageForIp;
};

const defaultDeps: HandleSupportMessageDeps = { submitSupportMessageForIp };

/**
 * `POST /api/v1/support/message` — the one **unauthenticated** route. No
 * bearer token is checked; hCaptcha plus a 3-per-15-minutes IP limit are the
 * whole defence. Mirrors `submitSupportMessage` in
 * `src/lib/support.functions.ts`. See
 * `MILA_MOBILE/src/services/api/support.ts`.
 */
export async function handleSupportMessage(
  request: Request,
  deps: HandleSupportMessageDeps = defaultDeps,
): Promise<Response> {
  try {
    const body = await parseJsonBody(request);
    const input = SubmitSupportMessageInput.parse(body);

    const result = await deps.submitSupportMessageForIp(getClientIp(request), input);
    return Response.json(result);
  } catch (error) {
    return respondWithError("support/message", error);
  }
}

export const Route = createFileRoute("/api/v1/support/message")({
  server: {
    handlers: {
      POST: async ({ request }) => handleSupportMessage(request),
    },
  },
});
