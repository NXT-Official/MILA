import { queryOptions } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { memberAuthorization } from "@/lib/auth-session";
import { memberQueryRetry } from "@/lib/queries/member-query";
import {
  GARMENT_KIND_ORDER,
  garmentFor,
  garmentKindHeading,
  type Garment,
  type GarmentKind,
} from "@/lib/garment-label";

/**
 * Saved pieces: recommended products a member bookmarks to come back to
 * (table public.saved_products, migration 20261007120000_saved_products.sql).
 *
 * Until that migration is applied in an environment, every call degrades to
 * the typed `unavailable` state instead of throwing: the Save buttons hide and
 * /saved explains calmly. Only genuine failures (network, RLS refusal) throw.
 */

export type SavedProductsClient = SupabaseClient<Database>;

export type SavedProductSource = "look" | "dupe" | "post_item";

const SOURCES: readonly SavedProductSource[] = ["look", "dupe", "post_item"];

/** What the product was when it was saved. Written by the database trigger. */
export type SavedProductSnapshot = {
  title: string;
  image_url: string | null;
  product_url: string | null;
  price: number | null;
  currency: string | null;
  category: string | null;
  brand: string | null;
};

/** The catalog row as it is now. null: the product has been deleted. */
export type SavedProductLive = {
  in_stock: boolean;
  verification_status: string;
  affiliate_link: string;
};

export type SavedProduct = {
  id: string;
  product_id: string | null;
  source: SavedProductSource;
  outfit_id: string | null;
  post_item_id: string | null;
  created_at: string;
  snapshot: SavedProductSnapshot;
  live: SavedProductLive | null;
};

export type SavedProductsState =
  { status: "ready"; items: SavedProduct[] } | { status: "unavailable" };

type ErrorLike = { code?: string | null; message?: string } | null | undefined;

/** PGRST205: PostgREST has no such table. 42P01: Postgres has no such relation. */
const UNAVAILABLE_CODES = new Set(["PGRST205", "42P01"]);

export function isFeatureUnavailableError(error: ErrorLike): boolean {
  return !!error?.code && UNAVAILABLE_CODES.has(error.code);
}

const SAVED_SELECT =
  "id,product_id,source,outfit_id,post_item_id,created_at,snapshot,products(in_stock,verification_status,affiliate_link)";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseSnapshot(value: unknown): SavedProductSnapshot {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const s = v as Record<string, unknown>;
  const price = typeof s.price === "number" ? s.price : Number(s.price);
  return {
    title: text(s.title) ?? "Saved piece",
    image_url: text(s.image_url),
    product_url: text(s.product_url),
    price: s.price != null && Number.isFinite(price) ? price : null,
    currency: text(s.currency),
    category: text(s.category),
    brand: text(s.brand),
  };
}

function parseSource(value: unknown): SavedProductSource {
  return SOURCES.includes(value as SavedProductSource) ? (value as SavedProductSource) : "look";
}

export async function listSavedProducts(
  client: SavedProductsClient,
  userId: string,
  /** Her `Bearer …` header (see `memberAuthorization`), so the read never runs as anonymous. */
  authorization?: string,
): Promise<SavedProductsState> {
  const request = client
    .from("saved_products")
    .select(SAVED_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const { data, error } = await (authorization
    ? request.setHeader("Authorization", authorization)
    : request);
  if (error) {
    if (isFeatureUnavailableError(error)) return { status: "unavailable" };
    throw error;
  }
  const items = (data ?? []).map((row) => ({
    id: row.id,
    product_id: row.product_id,
    source: parseSource(row.source),
    outfit_id: row.outfit_id,
    post_item_id: row.post_item_id,
    created_at: row.created_at,
    snapshot: parseSnapshot(row.snapshot),
    live: row.products
      ? {
          in_stock: row.products.in_stock,
          verification_status: row.products.verification_status,
          affiliate_link: row.products.affiliate_link,
        }
      : null,
  }));
  return { status: "ready", items };
}

export type SaveProductInput = {
  productId: string;
  source: SavedProductSource;
  outfitId?: string | null;
  postItemId?: string | null;
};

export async function saveProduct(
  client: SavedProductsClient,
  userId: string,
  input: SaveProductInput,
): Promise<"saved" | "already_saved" | "unavailable"> {
  const { error } = await client.from("saved_products").insert({
    user_id: userId,
    product_id: input.productId,
    source: input.source,
    outfit_id: input.outfitId ?? null,
    post_item_id: input.postItemId ?? null,
    // Required by the column's NOT NULL; the BEFORE INSERT trigger replaces it
    // with the catalog's own values, so nothing the client sends is stored.
    snapshot: {},
  });
  if (!error) return "saved";
  // 23505: unique (user_id, product_id). Saving twice is still "saved".
  if (error.code === "23505") return "already_saved";
  if (isFeatureUnavailableError(error)) return "unavailable";
  throw error;
}

export async function unsaveProduct(
  client: SavedProductsClient,
  userId: string,
  target: { productId: string } | { savedId: string },
): Promise<"removed" | "not_found" | "unavailable"> {
  // src: node_modules/@supabase/postgrest-js/dist/index.d.mts · 2.110.0 · delete({ count }) sends Prefer: count=exact
  const base = client.from("saved_products").delete({ count: "exact" }).eq("user_id", userId);
  const { error, count } = await ("savedId" in target
    ? base.eq("id", target.savedId)
    : base.eq("product_id", target.productId));
  if (error) {
    if (isFeatureUnavailableError(error)) return "unavailable";
    throw error;
  }
  // PostgREST answers a zero-row DELETE with success; only a counted row is a removal.
  return count != null && count > 0 ? "removed" : "not_found";
}

/** Fast "is this product saved?" lookup. Deleted products have no id and are skipped. */
export function savedProductIds(state: SavedProductsState | undefined): Set<string> {
  if (state?.status !== "ready") return new Set();
  const ids = new Set<string>();
  for (const item of state.items) if (item.product_id) ids.add(item.product_id);
  return ids;
}

/** The fields a recommendation card already has, enough to draw a saved row before the server answers. */
export type SaveableProduct = {
  id: string;
  title: string;
  image_url: string | null;
  affiliate_link: string;
  price: number;
  currency: string;
  category: string;
  /** The card's link check, when it has one (ShoppablePick and DupeMatch do). */
  verification_status?: string;
};

const OPTIMISTIC_PREFIX = "optimistic-";

export function optimisticSavedProduct(
  product: SaveableProduct,
  context: { source: SavedProductSource; outfitId?: string | null; postItemId?: string | null },
  now: string,
): SavedProduct {
  return {
    id: `${OPTIMISTIC_PREFIX}${product.id}`,
    product_id: product.id,
    source: context.source,
    outfit_id: context.outfitId ?? null,
    post_item_id: context.postItemId ?? null,
    created_at: now,
    snapshot: {
      title: product.title,
      image_url: product.image_url,
      product_url: product.affiliate_link,
      price: product.price,
      currency: product.currency,
      category: product.category,
      brand: null,
    },
    // Recommendations only ever show in-stock pieces with a working link (the
    // server filters both), so the row reads "available" at once instead of
    // "No longer available" until the list reloads.
    live: {
      in_stock: true,
      verification_status: product.verification_status ?? "unverified",
      affiliate_link: product.affiliate_link,
    },
  };
}

/** A row drawn before the server answered; its id was never stored. */
export function isPendingSave(item: SavedProduct): boolean {
  return item.id.startsWith(OPTIMISTIC_PREFIX);
}

/** What to delete for a Remove tap: a pending row by its product, a stored row by its id. */
export function removeTarget(item: SavedProduct): { productId: string } | { savedId: string } {
  return isPendingSave(item) && item.product_id
    ? { productId: item.product_id }
    : { savedId: item.id };
}

export function withSavedProduct(
  state: SavedProductsState | undefined,
  item: SavedProduct,
): SavedProductsState | undefined {
  if (state?.status !== "ready") return state;
  if (item.product_id && state.items.some((i) => i.product_id === item.product_id)) return state;
  return { status: "ready", items: [item, ...state.items] };
}

export function withoutSavedProduct(
  state: SavedProductsState | undefined,
  productId: string,
): SavedProductsState | undefined {
  if (state?.status !== "ready") return state;
  return { status: "ready", items: state.items.filter((i) => i.product_id !== productId) };
}

export type SavedAvailability = "available" | "gone" | "out_of_stock" | "link_unavailable";

export function savedAvailability(item: SavedProduct): SavedAvailability {
  if (!item.product_id || !item.live) return "gone";
  if (item.live.verification_status === "broken") return "link_unavailable";
  if (!item.live.in_stock) return "out_of_stock";
  return "available";
}

export type SavedGroup = {
  kind: GarmentKind;
  heading: string;
  items: Array<{ item: SavedProduct; garment: Garment }>;
};

/** Saved pieces grouped by garment, head to toe; each group keeps the list's order. */
export function groupSavedByKind(items: SavedProduct[]): SavedGroup[] {
  const byKind = new Map<GarmentKind, SavedGroup["items"]>();
  for (const item of items) {
    const garment = garmentFor(item.snapshot.category, item.snapshot.title);
    const bucket = byKind.get(garment.kind) ?? [];
    bucket.push({ item, garment });
    byKind.set(garment.kind, bucket);
  }
  return GARMENT_KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
    kind,
    heading: garmentKindHeading(kind),
    items: byKind.get(kind) ?? [],
  }));
}

export const savedProductsQueryKey = (userId: string | undefined) =>
  ["saved-products", userId] as const;

export function savedProductsQueryOptions(
  userId: string | undefined,
  client: SavedProductsClient = supabase,
) {
  return queryOptions({
    queryKey: savedProductsQueryKey(userId),
    queryFn: async (): Promise<SavedProductsState> => {
      if (!userId) return { status: "ready", items: [] };
      // Read as her, never as anonymous (an anonymous read sees no saved pieces).
      const authorization = await memberAuthorization(client.auth, userId);
      return listSavedProducts(client, userId, authorization);
    },
    staleTime: 60_000,
    retry: memberQueryRetry,
  });
}
