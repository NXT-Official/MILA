import { createFileRoute } from "@tanstack/react-router";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import { ConciergeChatInput, conciergeReply } from "@/server/services/concierge-chat";
import { toApiError } from "../look/generate";

/**
 * `POST /api/v1/concierge/chat` — one styling conversation turn.
 *
 * The history arrives from the client because mobile persists the thread itself
 * through RLS, but it is budgeted and re-grounded against the member's stored
 * dossier inside the service — a client cannot talk Mila out of the profile it
 * styles from by editing the transcript it sends.
 */
export const Route = createFileRoute("/api/v1/concierge/chat")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);

        const parsed = ConciergeChatInput.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError("VALIDATION_FAILED", "That message couldn't be sent.", 400);
        }

        try {
          return ok(await conciergeReply({ supabase, userId: user.id, input: parsed.data }));
        } catch (error) {
          throw toApiError(error);
        }
      }),
    },
  },
});
