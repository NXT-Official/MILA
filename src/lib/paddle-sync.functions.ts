import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireEnv } from "@/lib/env";

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
