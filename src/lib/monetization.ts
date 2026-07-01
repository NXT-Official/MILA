import { supabase } from "@/integrations/supabase/client";

export type ProductId = "remove_ads";

export interface Product {
  id: ProductId;
  name: string;
  description: string;
  priceCents: number; // placeholder pricing
  currency: string;
  kind: "ads";
}

// Placeholder catalog — swap to real IAP product IDs later.
export const PRODUCTS: Record<ProductId, Product> = {
  remove_ads: {
    id: "remove_ads",
    name: "Remove ads",
    description: "Permanently disable banner and rewarded ads.",
    priceCents: 499,
    currency: "USD",
    kind: "ads",
  },
};

export interface Entitlements {
  user_id: string;
  ads_removed: boolean;
}

export async function fetchEntitlements(userId: string): Promise<Entitlements> {
  // TODO: Re-enable premium gate before production launch
  // Demo/preview mode: report every user as fully entitled (ads removed,
  // premium unlocked). Restore the real entitlements lookup from git
  // history to bring gating back.
  return { user_id: userId, ads_removed: true };
}

// TODO: Re-enable premium gate before production launch
// Demo/preview helpers — always permissive.
export function isPremium(_userId?: string): boolean {
  return true;
}

export function hasAccess(_feature?: string): boolean {
  return true;
}

export function hasAvailableSlot(_kind?: string): boolean {
  return true;
}

/**
 * Placeholder IAP purchase flow. Records the purchase and grants the
 * corresponding entitlement. Replace with a real store callback (Stripe,
 * App Store, Play Billing) when wiring real billing.
 */
export async function purchaseProduct(
  userId: string,
  productId: ProductId,
): Promise<Entitlements> {
  const product = PRODUCTS[productId];
  if (!product) throw new Error("Unknown product");

  const { error: purchaseErr } = await supabase.from("purchases").insert({
    user_id: userId,
    product_id: product.id,
    amount_cents: product.priceCents,
    currency: product.currency,
    status: "completed",
    metadata: { placeholder: true },
  });
  if (purchaseErr) throw purchaseErr;

  const next: Partial<Entitlements> = {};
  if (product.kind === "ads") {
    next.ads_removed = true;
  }

  const { data: updated, error: entErr } = await supabase
    .from("user_entitlements")
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select("user_id,ads_removed")
    .single();
  if (entErr) throw entErr;

  return updated as Entitlements;
}

// ---------- Ads backend ----------

export type AdType = "banner" | "rewarded" | "interstitial";
export type AdEvent =
  | "impression"
  | "click"
  | "completed"
  | "reward_granted"
  | "dismissed";

export async function logAdEvent(
  userId: string,
  params: {
    adType: AdType;
    event: AdEvent;
    placement?: string;
    rewardType?: string;
    rewardAmount?: number;
    metadata?: Record<string, string | number | boolean | null>;
  },
) {
  await supabase.from("ad_events").insert({
    user_id: userId,
    ad_type: params.adType,
    event: params.event,
    placement: params.placement ?? null,
    reward_type: params.rewardType ?? null,
    reward_amount: params.rewardAmount ?? null,
    metadata: params.metadata ?? null,
  });
}

/**
 * Simulates a rewarded ad view. Replace internals with the real ad SDK
 * (AdMob, AppLovin, etc.) — the surrounding contract stays the same.
 */
export async function showRewardedAd(
  userId: string,
  reward: { type: string; amount: number; placement?: string },
): Promise<{ rewarded: boolean }> {
  await logAdEvent(userId, {
    adType: "rewarded",
    event: "impression",
    placement: reward.placement,
  });
  // TODO: hand off to ad SDK and await completion callback.
  await new Promise((r) => setTimeout(r, 1200));
  await logAdEvent(userId, {
    adType: "rewarded",
    event: "completed",
    placement: reward.placement,
  });
  await logAdEvent(userId, {
    adType: "rewarded",
    event: "reward_granted",
    placement: reward.placement,
    rewardType: reward.type,
    rewardAmount: reward.amount,
  });
  return { rewarded: true };
}

export function formatPrice(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}