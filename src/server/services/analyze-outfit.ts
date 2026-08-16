import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aiChatCompletion, aiFailure } from "@/lib/ai.server";
import { withAiCredit } from "@/lib/credits.server";
import { type AnalyzeOutfitInputType, type OutfitAnalysis } from "@/lib/outfit-analysis";
import { consumeRateLimit } from "@/lib/rate-limit.server";
import { assertTrustedStorageImageUrl } from "@/lib/trusted-image-url.server";

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

/**
 * The one implementation of "analyse this outfit". Called by the website's
 * `analyzeOutfit` server function and by `POST /api/v1/analysis/outfit`.
 *
 * Both the hourly rate limit and the credit charge live here, so neither client
 * can skip them, and `assertTrustedStorageImageUrl` keeps the SSRF guard on the
 * server where it belongs: the image must already be in Mila storage.
 */
export async function analyzeOutfitLook({
  supabase,
  userId,
  input: data,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  input: AnalyzeOutfitInputType;
}): Promise<OutfitAnalysis> {
  await consumeRateLimit(`ai:analyzeOutfit:${userId}`, {
    limit: 15,
    windowSeconds: 3600,
  });
  // The hourly cap above throttles bursts; this is what actually gates on
  // balance. Callers turn InsufficientCreditsError into the paywall.
  return withAiCredit(supabase, userId, async () => {
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
}
