import { z } from "zod";

export const BILLING_INTERVALS = ["monthly", "yearly", "one_time"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const BILLING_INTERVAL_LABELS: Record<BillingInterval, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  one_time: "One-time",
};

export const BILLING_INTERVAL_SUFFIX: Record<BillingInterval, string> = {
  monthly: "/ month",
  yearly: "/ year",
  one_time: "one-time",
};
export interface SubscriptionPlan {
  id: string;
  slug: string;
  title: string;
  description: string;
  price_amount: number;
  currency: string;
  billing_interval: BillingInterval;
  credits_included: number;
  features: string[];
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  paddle_product_id: string | null;
  paddle_price_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicSubscriptionPlan = Pick<
  SubscriptionPlan,
  | "id"
  | "slug"
  | "title"
  | "description"
  | "price_amount"
  | "currency"
  | "billing_interval"
  | "credits_included"
  | "features"
  | "is_featured"
>;

export const PUBLIC_PLAN_COLUMNS =
  "id,slug,title,description,price_amount,currency,billing_interval,credits_included,features,is_featured";

export function normalizePlanFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f): f is string => typeof f === "string")
    .map((f) => f.trim())
    .filter(Boolean);
}

export const planSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug must be at least 2 characters.")
  .max(60, "Slug must be at most 60 characters.")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers, and single hyphens only.");

export const createPlanInputSchema = z.object({
  slug: planSlugSchema,
  title: z.string().trim().min(1, "Title is required.").max(80),
  description: z.string().trim().max(280).default(""),
  price_amount: z.number().int().min(0).max(100_000_000),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, "Use a 3-letter currency code, e.g. usd."),
  billing_interval: z.enum(BILLING_INTERVALS),
  credits_included: z.number().int().min(0).max(1_000_000),
  features: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  is_active: z.boolean().default(false),
  is_featured: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(9999).default(0),
});
export type CreatePlanInput = z.infer<typeof createPlanInputSchema>;

export const updatePlanInputSchema = createPlanInputSchema.partial().extend({
  id: z.string().uuid(),
});
export type UpdatePlanInput = z.infer<typeof updatePlanInputSchema>;

export function slugifyPlanTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function parsePriceToCents(input: string): number | null {
  const match = input.trim().match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
}

export function centsToPriceInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function formatPlanPrice(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `${centsToPriceInput(amountCents)} ${currency}`;
  }
}
