import { createFileRoute } from "@tanstack/react-router";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import {
  DeleteAccountInput,
  EMAIL_MISMATCH,
  deleteAccountForUser,
} from "@/lib/account.functions";
import { supabaseDeleteAccountDeps } from "@/lib/account.server";

/**
 * `POST /api/v1/account/delete` — irreversible, and the one route with no undo.
 *
 * It calls the same `deleteAccountForUser` the website's server function does,
 * so the order that matters holds for both clients: **billing is cancelled
 * before anything is deleted**, and a Paddle failure aborts the whole thing.
 * Deleting the account first would leave a card being charged with no account
 * left to log into.
 *
 * Three things here need the service role — reading the account's real email,
 * purging storage, and deleting the auth user — which is why this cannot be a
 * direct Supabase call from the phone.
 */
export const Route = createFileRoute("/api/v1/account/delete")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        // `requireActiveMember`, matching the website's own middleware: a
        // suspended member is refused here exactly as she is on the web. Worth
        // revisiting deliberately with the web owner — self-serve deletion is
        // an App Store requirement — but mobile and web must not disagree on
        // who may delete an account.
        const { supabase, user } = await requireActiveMember(request);

        const parsed = DeleteAccountInput.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError("VALIDATION_FAILED", "Type your email address to confirm.", 400);
        }

        // The typed email is re-checked against the session's own address
        // inside the service. The client-side comparison is UX; this is the
        // one that counts.
        const result = await deleteAccountForUser(
          supabase,
          user.id,
          parsed.data.email,
          supabaseDeleteAccountDeps,
        );

        if ("error" in result) {
          throw result.error === EMAIL_MISMATCH
            ? new ApiError("VALIDATION_FAILED", result.error, 400)
            : // Billing or auth refused, and nothing was deleted. The member
              // has to be told which — "something went wrong" leaves her
              // unsure whether her account still exists.
              new ApiError("UPSTREAM_UNAVAILABLE", result.error, 503);
        }

        return ok(result);
      }),
    },
  },
});
