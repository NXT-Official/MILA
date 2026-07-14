import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiChatCompletion } from "./ai.server";
import { assertTrustedStorageImageUrl } from "./trusted-image-url.server";
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";
import {
  CLOTHING_CATEGORIES as CATEGORIES,
  CLOTHING_UNDERTONES as UNDERTONES,
} from "@/constants/wardrobe";

const ANALYZE_CLOTHING_LIMIT = 20;
const ANALYZE_CLOTHING_WINDOW_SECONDS = 60 * 60;

const MODES = ["catalog", "dupe-hunt"] as const;
export type AnalyzeClothingMode = (typeof MODES)[number];

const ClothingAttributesSchema = z.object({
  name: z.string().max(100),
  category: z.enum(CATEGORIES),
  primary_color: z.string(),
  color_undertone: z.enum(UNDERTONES),
  silhouette_tags: z.array(z.string()),
});

export type ClothingAttributes = z.infer<typeof ClothingAttributesSchema>;

const tool = {
  type: "function" as const,
  function: {
    name: "report_clothing_attributes",
    description: "Return structured attributes for a single clothing item.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "A short, human-friendly product-style name, e.g. 'Black cropped blazer'. Max 6 words.",
        },
        category: { type: "string", enum: CATEGORIES as unknown as string[] },
        primary_color: {
          type: "string",
          description: "The single dominant color of the garment, e.g. 'Navy', 'Olive', 'Cream'.",
        },
        color_undertone: { type: "string", enum: UNDERTONES as unknown as string[] },
        silhouette_tags: {
          type: "array",
          minItems: 2,
          maxItems: 3,
          items: { type: "string" },
          description:
            "2-3 lowercase design-element tags, e.g. 'high-waisted', 'A-line', 'crewneck', 'oversized'.",
        },
      },
      required: ["name", "category", "primary_color", "color_undertone", "silhouette_tags"],
      additionalProperties: false,
    },
  },
};

export const analyzeClothing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        imageUrl: z.string().url(),
        mode: z.enum(MODES).optional().default("catalog"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ClothingAttributes> => {
    try {
      await consumeRateLimit(
        `ai:analyzeClothing:${context.userId}`,
        ANALYZE_CLOTHING_LIMIT,
        ANALYZE_CLOTHING_WINDOW_SECONDS,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }
    const imageUrl = assertTrustedStorageImageUrl(data.imageUrl);

    const systemPrompt =
      data.mode === "dupe-hunt"
        ? "You are Mila — an elite luxury fashion archivist. Look at the inspiration piece in the image (likely high-end designer) and extract the structural silhouette and color attributes precisely so we can hunt budget dupes. The 'name' must be a vivid descriptor of the luxury reference, e.g. 'cream quilted top-handle vanity case with chain detailing'. silhouette_tags must isolate the SHAPE/CONSTRUCTION cues a dupe must match (e.g. 'top-handle', 'quilted', 'structured', 'chain-strap'). Always call the report_clothing_attributes tool with strict capitalization."
        : "You are Mila — an elite fashion archivist with the eye of a couturier. Look at the single clothing item in the image and identify its attributes. Always call the report_clothing_attributes tool. Pick exactly one category from the allowed list with matching capitalization. The primary_color must be a single common color word. The color_undertone must be Cool, Warm, or Neutral. silhouette_tags must be 2-3 short lowercase design descriptors (cut, neckline, fit, length).";

    const res = await aiChatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Catalogue this garment." },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "report_clothing_attributes" } },
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
    if (!call) throw new Error("AI did not return attributes.");

    const rawArguments = JSON.parse(call.function.arguments);
    const validatedData = ClothingAttributesSchema.parse(rawArguments);

    return validatedData;
  });
