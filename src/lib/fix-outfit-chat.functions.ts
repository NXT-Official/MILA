import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { consumeAiCredit } from "./credits.server";

const Message = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const Input = z.object({
  imageUrl: z.string().url(),
  bodyType: z.string().min(1).max(64),
  colorSeason: z.string().min(1).max(64),
  history: z.array(Message).max(40),
  message: z.string().min(1).max(2000),
});

const tool = {
  type: "function" as const,
  function: {
    name: "report_stylist_reply",
    description: "Return a short conversational stylist reply plus an optional tip.",
    parameters: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description: "Conversational answer, under 3 sentences, highly actionable.",
        },
        tip: {
          type: "string",
          description:
            "Optional one-line headline tip (e.g. 'Swap for a cool-toned silver accessory'). Empty string if not applicable.",
        },
      },
      required: ["reply", "tip"],
      additionalProperties: false,
    },
  },
};

export const fixOutfitChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    // Credit gate — throws "INSUFFICIENT_CREDITS" if depleted.
    await consumeAiCredit(context.supabase, context.userId);

    const systemPrompt = `You are Mila, an elite, highly perceptive personal fashion stylist trained in specialized color theory and balance. Your tone is authoritative, elegant, and highly tailored. Use the user's saved 16-season profile (${data.colorSeason}) and body type (${data.bodyType}) to guide their wardrobe tweaks, weather choices, and travel looks with precision. Keep replies under three sentences, never apologetic, never tentative. When lighting or the photo isn't ideal, attribute it confidently to "the studio light" — never to user error. Do not re-evaluate the entire outfit score unless the user explicitly asks "Re-score my outfit". Always call the report_stylist_reply tool.`;

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Here is the outfit we're discussing." },
          { type: "image_url", image_url: { url: data.imageUrl } },
        ],
      },
      ...data.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: data.message },
    ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        tools: [tool],
        tool_choice: { type: "function", function: { name: "report_stylist_reply" } },
      }),
    });

    if (res.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace settings.");
    if (!res.ok) {
      const t = await res.text();
      console.error("Gateway error", res.status, t);
      throw new Error("Stylist chat failed.");
    }

    const json = await res.json();
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("AI did not return a reply.");
    const args = JSON.parse(call.function.arguments);
    return args as { reply: string; tip: string };
  });