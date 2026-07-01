import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
        color_match: { type: "string", description: "1-2 sentence verdict on color harmony with the user's season." },
        silhouette: { type: "string", description: "1-2 sentence verdict on how the silhouette flatters the user's body type." },
        overall_score: { type: "integer", minimum: 0, maximum: 100, description: "Overall match score 0-100." },
        verdict: { type: "string", description: "2-4 sentences, candid but encouraging overall feedback with one concrete suggestion." },
      },
      required: ["color_match", "silhouette", "overall_score", "verdict"],
      additionalProperties: false,
    },
  },
};

export const analyzeOutfit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an expert fashion stylist and color analyst. You are evaluating an outfit for a user with a ${data.bodyType} body type and a ${data.colorSeason} color profile. Look at the attached image. Does the silhouette flatter their specific body type? Do the colors harmonize with their season? Be candid but encouraging. Always call the report_outfit_analysis tool with your findings.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this outfit for me." },
              { type: "image_url", image_url: { url: data.imageUrl } },
            ],
          },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "report_outfit_analysis" } },
      }),
    });

    if (res.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace settings.");
    if (!res.ok) {
      const t = await res.text();
      console.error("Gateway error", res.status, t);
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