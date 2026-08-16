import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import { requireEnv } from "@/lib/env";

const SyncInput = z.object({ transactionId: z.string().min(1).max(128) });

/**
 * `POST /api/v1/billing/sync` — makes activation feel instant, and nothing more.
 *
 * The webhook is the system of record; this exists only so a member who has
 * just paid does not stare at a stale balance while it lands. That is why
 * `{ synced: false }` is a **200**: the transaction may simply belong to
 * someone else or carry no subscription, and in every one of those cases the
 * honest answer is "nothing applied here" rather than an error the phone would
 * surface to a member whose payment is fine.
 *
 * Ownership is re-checked inside the service against `custom_data.user_id` —
 * without it, anyone could post another member's transaction id and claim
 * their payment.
 */
export const Route = createFileRoute("/api/v1/billing/sync")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { user } = await requireActiveMember(request);

        const parsed = SyncInput.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError("VALIDATION_FAILED", "That payment couldn't be confirmed.", 400);
        }

        const { PADDLE_SANDBOX_API_KEY } = requireEnv({
          PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
        });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncPaddleTransactionForUser, paddleApi } =
          await import("@/lib/paddle-sync.server");

        try {
          return ok(
            await syncPaddleTransactionForUser(
              supabaseAdmin,
              user.id,
              parsed.data.transactionId,
              paddleApi(PADDLE_SANDBOX_API_KEY),
            ),
          );
        } catch (error) {
          console.error("[api/v1/billing/sync] lookup failed", error);
          throw new ApiError(
            "UPSTREAM_UNAVAILABLE",
            "Payment received — your plan will appear shortly.",
            503,
          );
        }
      }),
    },
  },
});
