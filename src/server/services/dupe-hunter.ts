import { z } from "zod";
import { aiChatCompletion, aiFailure } from "@/lib/ai.server";
import {
  CLOTHING_CATEGORIES as CATEGORIES,
  CLOTHING_UNDERTONES as UNDERTONES,
} from "@/constants/clothing";
import { withAiCredit } from "@/lib/credits.server";
import { consumeRateLimit } from "@/lib/rate-limit.server";
import { assertTrustedStorageImageUrl } from "@/lib/trusted-image-url.server";
import { ClothingAttributesSchema, type ClothingAttributes } from "@/lib/outfit-items";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const DupeHuntInput = z.object({
  imageUrl: z.string().url(),
  maxResults: z.number().int().min(1).max(20).optional().default(6),
});

const tool = {
  function: {
    name: "report_clothing_attributes",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Vivid luxury descriptor, e.g. 'cream quilted top-handle vanity case'.",
        },
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

/**
 * Attributes in, ranked catalog matches out. No vision, no credit — the drawer
 * already has the attributes stored on the post item.
 */
export async function rankDupes(
  supabase: SupabaseClient<Database>,
  inspiration: ClothingAttributes,
  maxResults: number,
): Promise<DupeMatch[]> {
  const { data: candidates, error } = await supabase
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

  return (candidates ?? [])
    .filter((p) => !!p.affiliate_link)
    .map((product) => {
      const { score, reasons } = scoreCandidate(inspiration, product);
      return { product, score, reasons };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.product.price - b.product.price;
    })
    .slice(0, maxResults)
    .map(({ product, score, reasons }) => ({
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
}

/**
 * The one implementation of dupe hunting: vision extraction, then ranking.
 * Called by the website's `findDupes` and by `POST /api/v1/dupes/hunt`.
 */
export async function huntDupes({
  supabase,
  userId,
  input: data,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  input: z.infer<typeof DupeHuntInput>;
}): Promise<DupeHuntResult> {
  {
    await consumeRateLimit(`ai:findDupes:${userId}`, { limit: 15, windowSeconds: 3600 });
    return withAiCredit(supabase, userId, async () => {
      const imageUrl = assertTrustedStorageImageUrl(data.imageUrl);

      const systemPrompt =
        "You are Mila — an elite luxury fashion archivist. Look at the inspiration piece in the image (likely high-end designer) and extract precise structural silhouette and color attributes so we can match budget dupes. silhouette_tags must isolate the SHAPE/CONSTRUCTION cues a dupe must match. Always call the report_clothing_attributes tool.";

      const result = await aiChatCompletion(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the structural attributes for dupe hunting." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        tool,
      );
      if (!result.ok) throw aiFailure(result.status, "Dupe extraction failed.");

      const inspiration = ClothingAttributesSchema.parse(result.args);
      const dupes = await rankDupes(supabase, inspiration, data.maxResults);
      return { inspiration, dupes };
    });
  }
}
