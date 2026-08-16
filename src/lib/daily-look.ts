import { z } from "zod";

/**
 * The Daily Look wire contract — schemas and types only, no server imports.
 *
 * It lives apart from `@/server/services/generate-look` because that module
 * pulls in `ai.server` and the Cloudflare client, and TanStack Start's import
 * protection (correctly) refuses to let those reach the browser bundle. The
 * dashboard needs the *types*; it must never need the provider keys.
 */
export const GenerateLookInput = z.object({
  bodyType: z.string().min(1).max(64),
  colorSeason: z.string().min(1).max(64),
  skinUndertone: z.string().min(1).max(64).optional().nullable(),
  faceShape: z.string().min(1).max(64).optional().nullable(),
  hairType: z.string().min(1).max(64).optional().nullable(),
  weather: z.string().min(1).max(120),
  tempF: z.number().min(-60).max(140).optional(),
  tempC: z.number().min(-50).max(60).optional(),
  condition: z.enum(["Sunny", "Cloudy", "Overcast", "Rain", "Snow", "Windy"]).optional(),
  location: z.string().min(1).max(120).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  vibe: z.string().min(1).max(64),
});

export const DailyLookSchema = z.object({
  outfit: z.object({
    headline: z.string().min(1),
    description: z.string().min(1),
    styling_notes: z.string().min(1),
  }),
  hair: z.object({
    style: z.string().min(1),
    execution_tip: z.string().min(1),
  }),
  makeup: z.object({
    palette: z.string().min(1),
    details: z.string().min(1),
  }),
  vibe_alignment_score: z.number().int().min(1).max(10),
});
export type DailyLook = z.infer<typeof DailyLookSchema>;
export type GenerateLookInputType = z.infer<typeof GenerateLookInput>;

export type GeneratedLook = DailyLook & {
  imageDataUri: string | null;
  imageGenerationError?: string;
};
