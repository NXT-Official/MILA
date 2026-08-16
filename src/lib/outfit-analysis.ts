import { z } from "zod";

/**
 * The outfit-analysis wire contract — schema and result type only.
 *
 * Split from the service for the same reason as `daily-look.ts`: the service
 * imports `ai.server`, and TanStack Start's import protection (correctly) keeps
 * that out of the browser bundle. Callers need the shape, not the keys.
 */
export const AnalyzeOutfitInput = z.object({
  imageUrl: z.string().url(),
  bodyType: z.string().min(1).max(64),
  colorSeason: z.string().min(1).max(64),
});

export type AnalyzeOutfitInputType = z.infer<typeof AnalyzeOutfitInput>;

export type OutfitAnalysis = {
  color_match: string;
  silhouette: string;
  overall_score: number;
  verdict: string;
};
