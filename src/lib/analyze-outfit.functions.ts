import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiChatCompletion } from "./ai.server";
import { assertTrustedStorageImageUrl } from "./trusted-image-url.server";
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";

const ANALYZE_OUTFIT_LIMIT = 15;
const ANALYZE_OUTFIT_WINDOW_SECONDS = 60 * 60;

const Input = z.object({
  imageUrl: z.string().url(),
  bodyType: z.string().min(1).max(64),
  colorSeason: z.string().min(1).max(64),
});

const tool = {
  type: "function" as const,
  function: {
    name: "report_outfit_analysis",
    description: "Return a structured analysis of the outfit.",
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
    try {
      await consumeRateLimit(
        `ai:analyzeOutfit:${context.userId}`,
        ANALYZE_OUTFIT_LIMIT,
        ANALYZE_OUTFIT_WINDOW_SECONDS,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }
    const imageUrl = assertTrustedStorageImageUrl(data.imageUrl);

    const systemPrompt = `You are an expert fashion stylist and color analyst. You are evaluating an outfit for a user with a ${data.bodyType} body type and a ${data.colorSeason} color profile. Look at the attached image. Does the silhouette flatter their specific body type? Do the colors harmonize with their season? Be candid but encouraging. Always call the report_outfit_analysis tool with your findings.`;

    const res = await aiChatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this outfit for me." },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "report_outfit_analysis" } },
    });

    if (res.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Please try again later.");
    if (!res.ok) {
      const t = await res.text();
      console.error("AI provider error", res.status, t);
      throw new Error("AI analysis failed.");
    }

    const json = await res.json();
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("AI did not return analysis.");
    const args = JSON.parse(call.function.arguments);
    return args as {
      color_match: string;
      silhouette: string;
      overall_score: number;
      verdict: string;
    };
  });
