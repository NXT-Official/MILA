import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiChatCompletion, aiFailure } from "./ai.server";
import { assertTrustedStorageImageUrl } from "./trusted-image-url.server";
import { consumeRateLimit } from "./rate-limit.server";
import { withAiCredit } from "./credits.server";

const Input = z.object({
  imageUrl: z.string().url(),
  bodyType: z.string().min(1).max(64),
  colorSeason: z.string().min(1).max(64),
});

const tool = {
  function: {
    name: "report_outfit_analysis",
    parameters: {
      type: "object",
      properties: {
        color_match: {
          type: "string",
          description: "1-2 sentence verdict on color harmony with the user's season.",
        },
        silhouette: {
          type: "string",
          description: "1-2 sentence verdict on how the silhouette flatters the user's body type.",
        },
        overall_score: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Overall match score 0-100.",
        },
        verdict: {
          type: "string",
          description:
            "2-4 sentences, candid but encouraging overall feedback with one concrete suggestion.",
        },
      },
      required: ["color_match", "silhouette", "overall_score", "verdict"],
      additionalProperties: false,
    },
  },
};

export const analyzeOutfit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    await consumeRateLimit(`ai:analyzeOutfit:${context.userId}`, {
      limit: 15,
      windowSeconds: 3600,
    });
    // The hourly cap above throttles bursts; this is what actually gates on
    // balance. Callers turn InsufficientCreditsError into the paywall.
    return withAiCredit(context.supabase, context.userId, async () => {
      const imageUrl = assertTrustedStorageImageUrl(data.imageUrl);

      const systemPrompt = `You are an expert fashion stylist and color analyst. You are evaluating an outfit for a user with a ${data.bodyType} body type and a ${data.colorSeason} color profile. Look at the attached image. Does the silhouette flatter their specific body type? Do the colors harmonize with their season? Be candid but encouraging. Always call the report_outfit_analysis tool with your findings.`;

      const result = await aiChatCompletion(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this outfit for me." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        tool,
      );
      if (!result.ok) throw aiFailure(result.status, "AI analysis failed.");

      return result.args as {
        color_match: string;
        silhouette: string;
        overall_score: number;
        verdict: string;
      };
    });
  });
