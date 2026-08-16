import { createFileRoute } from "@tanstack/react-router";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import {
  SubmitSupportMessageInput,
  submitSupportMessageService,
  toSupportApiError,
} from "@/server/services/support";

/**
 * `POST /api/v1/support/message` — **the only unauthenticated route in `/api/v1`.**
 *
 * Deliberately so: help has to be reachable by someone who cannot sign in,
 * which is exactly why it is the one route that must not call
 * `requireActiveMember`. The captcha and the IP limit inside the service are
 * the defence that replaces the session, and both run before the insert.
 *
 * Nothing about the caller is recorded — `support_messages` has no `user_id`
 * column, and adding one would be a schema change.
 */
export const Route = createFileRoute("/api/v1/support/message")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const parsed = SubmitSupportMessageInput.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError("VALIDATION_FAILED", "That message couldn't be sent.", 400);
        }

        try {
          return ok(await submitSupportMessageService(parsed.data));
        } catch (error) {
          throw toSupportApiError(error);
        }
      }),
    },
  },
});
