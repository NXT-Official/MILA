import { z } from "zod";
import { catalogItemInputShape } from "@/lib/subscription-plans";

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
  ...catalogItemInputShape,
  credits: z.number().int().min(1).max(1_000_000),
});

export const updateCreditPackInputSchema = createCreditPackInputSchema.partial().extend({
  id: z.string().uuid(),
});
