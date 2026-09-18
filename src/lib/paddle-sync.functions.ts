import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { syncPurchaseForUser } from "@/server/services/billing";

export const SyncPaddlePurchaseInput = z.object({
  transactionId: z.string().min(1).max(128),
});
export type SyncPaddlePurchaseInputData = z.infer<typeof SyncPaddlePurchaseInput>;

export const syncPaddlePurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SyncPaddlePurchaseInput.parse(input))
  .handler(async ({ data, context }) => syncPurchaseForUser(context.userId, data.transactionId));
