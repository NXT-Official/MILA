import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { analyzeOutfitForUser } from "@/server/services/outfit-analysis";

export const Input = z.object({
  imageUrl: z.string().url(),
  bodyType: z.string().min(1).max(64),
  colorSeason: z.string().min(1).max(64),
});
export type AnalyzeOutfitInputData = z.infer<typeof Input>;

export const analyzeOutfit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) =>
    analyzeOutfitForUser(context.supabase, context.userId, data),
  );
