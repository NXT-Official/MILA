import { z } from "zod";
import { planSlugSchema } from "@/lib/subscription-plans";

export interface CreditPack {
  id: string;
  slug: string;
  title: string;
  description: string;
  price_amount: number;
  currency: string;
  credits: number;
  is_active: boolean;
  sort_order: number;
  paddle_product_id: string | null;
  paddle_price_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicCreditPack = Pick<
  CreditPack,
  | "id"
  | "slug"
  | "title"
  | "description"
  | "price_amount"
  | "currency"
  | "credits"
  | "paddle_price_id"
>;

export const PUBLIC_PACK_COLUMNS =
  "id,slug,title,description,price_amount,currency,credits,paddle_price_id";

export const createCreditPackInputSchema = z.object({
  slug: planSlugSchema,
  title: z.string().trim().min(1, "Title is required.").max(80),
  description: z.string().trim().max(280).default(""),
  price_amount: z.number().int().min(0).max(100_000_000),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, "Use a 3-letter currency code, e.g. usd."),
  credits: z.number().int().min(1).max(1_000_000),
  is_active: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(9999).default(0),
});
export type CreateCreditPackInput = z.infer<typeof createCreditPackInputSchema>;

export const updateCreditPackInputSchema = createCreditPackInputSchema.partial().extend({
  id: z.string().uuid(),
});
export type UpdateCreditPackInput = z.infer<typeof updateCreditPackInputSchema>;
