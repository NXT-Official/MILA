import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireEnv } from "@/lib/env";

/**
 * Applies a just-completed checkout without waiting for the Paddle webhook —
 * which can't reach a dev machine at all, and can lag or fail in production.
 *
 * The implementation lives in paddle-sync.server.ts and is imported inside the
 * handler: this module is pulled into the client bundle by usePaddleCheckout,
 * and a top-level import would drag the webhook appliers along with it.
 */
export const syncPaddlePurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ transactionId: z.string().min(1).max(128) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { PADDLE_SANDBOX_API_KEY } = requireEnv({
      PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncPaddleTransactionForUser, paddleApi } = await import("./paddle-sync.server");
    return syncPaddleTransactionForUser(
      supabaseAdmin,
      context.userId,
      data.transactionId,
      paddleApi(PADDLE_SANDBOX_API_KEY),
    );
  });
