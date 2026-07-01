import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { consumeAiCredit } from "./credits.server";
import type { ClothingAttributes } from "./analyze-clothing.functions";

const CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Dresses", "Shoes", "Accessories"] as const;
const UNDERTONES = ["Cool", "Warm", "Neutral"] as const;

const Input = z.object({
  imageUrl: z.string().url(),
  maxResults: z.number().int().min(1).max(20).optional().default(6),
});

const tool = {
  type: "function" as const,
  function: {
    name: "report_clothing_attributes",
    description: "Extract structural attributes of an inspiration luxury piece for dupe matching.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Vivid luxury descriptor, e.g. 'cream quilted top-handle vanity case'." },
        category: { type: "string", enum: CATEGORIES as unknown as string[] },
        primary_color: { type: "string" },
        color_undertone: { type: "string", enum: UNDERTONES as unknown as string[] },
        silhouette_tags: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "string" },
          description: "Structural shape/construction cues the dupe must match.",
        },
      },
      required: ["name", "category", "primary_color", "color_undertone", "silhouette_tags"],
      additionalProperties: false,
    },
  },
};

export type DupeMatch = {
  id: string;
  title: string;
  brand_id: string;
  category: string;
  price: number;
  currency: string;
  image_url: string | null;
  affiliate_link: string;
  description: string | null;
  match_score: number;
  match_reasons: string[];
};

export type DupeHuntResult = {
  inspiration: ClothingAttributes;
  dupes: DupeMatch[];
};

/**
 * Score how strongly a product candidate matches the inspiration's
 * silhouette + color undertone + category.
 */
function scoreCandidate(
  inspiration: ClothingAttributes,
  product: {
    title: string;
    description: string | null;
    category: string;
    seasonal_palettes: string[];
  },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (product.category.toLowerCase() === inspiration.category.toLowerCase()) {
    score += 40;
    reasons.push(`Same category (${product.category})`);
  }

  const haystack = `${product.title} ${product.description ?? ""}`.toLowerCase();

  let silhouetteHits = 0;
  for (const tag of inspiration.silhouette_tags) {
    if (haystack.includes(tag.toLowerCase())) {
      silhouetteHits += 1;
      reasons.push(`Matches "${tag}"`);
    }
  }
  score += silhouetteHits * 15;

  if (haystack.includes(inspiration.primary_color.toLowerCase())) {
    score += 20;
    reasons.push(`Shares ${inspiration.primary_color} color`);
  }

  const undertoneMap: Record<string, string[]> = {
    Warm: ["spring", "autumn"],
    Cool: ["summer", "winter"],
    Neutral: ["spring", "summer", "autumn", "winter"],
  };
  const undertoneFamilies = undertoneMap[inspiration.color_undertone] ?? [];
  const paletteHit = product.seasonal_palettes.some((p) =>
    undertoneFamilies.some((fam) => p.toLowerCase().includes(fam)),
  );
  if (paletteHit) {
    score += 10;
    reasons.push(`${inspiration.color_undertone} undertone fit`);
  }

  return { score, reasons };
}

export const findDupes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<DupeHuntResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    await consumeAiCredit(context.supabase, context.userId);

    // Step 1 — extract structural attributes of the inspiration piece.
    const systemPrompt =
      "You are Mila — an elite luxury fashion archivist. Look at the inspiration piece in the image (likely high-end designer) and extract precise structural silhouette and color attributes so we can match budget dupes. silhouette_tags must isolate the SHAPE/CONSTRUCTION cues a dupe must match. Always call the report_clothing_attributes tool.";

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the structural attributes for dupe hunting." },
              { type: "image_url", image_url: { url: data.imageUrl } },
            ],
          },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "report_clothing_attributes" } },
      }),
    });

    if (aiRes.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
    if (aiRes.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace settings.");
    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("Gateway error", aiRes.status, t);
      throw new Error("Dupe extraction failed.");
    }

    const json = await aiRes.json();
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("AI did not return attributes.");
    const inspiration = JSON.parse(call.function.arguments) as ClothingAttributes;

    // Step 2 — query candidate products (scope by category first for speed).
    const { data: candidates, error } = await context.supabase
      .from("products")
      .select(
        "id,title,description,category,price,currency,image_url,affiliate_link,brand_id,seasonal_palettes",
      )
      .ilike("category", inspiration.category)
      .limit(200);

    if (error) {
      console.error("Product query failed", error);
      throw new Error("Couldn't search the dupe catalog.");
    }

    // Step 3 — score, sort, and return top N with affiliate links.
    const ranked = (candidates ?? [])
      .filter((p) => !!p.affiliate_link)
      .map((p) => {
        const { score, reasons } = scoreCandidate(inspiration, p);
        return { product: p, score, reasons };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.product.price - b.product.price; // cheaper wins on a tie
      })
      .slice(0, data.maxResults);

    const dupes: DupeMatch[] = ranked.map(({ product, score, reasons }) => ({
      id: product.id,
      title: product.title,
      brand_id: product.brand_id,
      category: product.category,
      price: product.price,
      currency: product.currency,
      image_url: product.image_url,
      affiliate_link: product.affiliate_link,
      description: product.description,
      match_score: score,
      match_reasons: reasons,
    }));

    return { inspiration, dupes };
  });