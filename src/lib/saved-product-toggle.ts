import type { QueryClient } from "@tanstack/react-query";
import {
  optimisticSavedProduct,
  saveProduct,
  savedProductsQueryKey,
  unsaveProduct,
  withSavedProduct,
  withoutSavedProduct,
  type SaveableProduct,
  type SavedProductSource,
  type SavedProductsClient,
  type SavedProductsState,
} from "@/lib/queries/saved-products";
import { trackEvent } from "@/lib/track-event";

export type SaveContext = {
  source: SavedProductSource;
  outfitId?: string | null;
  postItemId?: string | null;
};

export type ToggleOutcome =
  "saved" | "already_saved" | "removed" | "not_found" | "unavailable" | "failed";

/**
 * Saves or removes one recommended piece with an optimistic cache update.
 * The bookmark flips at once; a failed write puts it back, and the caller
 * decides what to tell the member from the outcome. Analytics only fire for
 * writes that actually happened (a counted delete, a fresh insert).
 */
export async function toggleSavedProduct({
  client,
  queryClient,
  userId,
  product,
  context,
  currentlySaved,
  now = new Date().toISOString(),
}: {
  client: SavedProductsClient;
  queryClient: QueryClient;
  userId: string;
  product: SaveableProduct;
  context: SaveContext;
  currentlySaved: boolean;
  now?: string;
}): Promise<{ outcome: ToggleOutcome; error?: unknown }> {
  const queryKey = savedProductsQueryKey(userId);
  await queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueryData<SavedProductsState>(queryKey);
  queryClient.setQueryData<SavedProductsState>(queryKey, (state) =>
    currentlySaved
      ? withoutSavedProduct(state, product.id)
      : withSavedProduct(state, optimisticSavedProduct(product, context, now)),
  );

  const analytics = { product_id: product.id, source: context.source };
  try {
    if (currentlySaved) {
      const result = await unsaveProduct(client, userId, { productId: product.id });
      if (result === "unavailable") {
        queryClient.setQueryData<SavedProductsState>(queryKey, { status: "unavailable" });
      } else if (result === "removed") {
        void trackEvent(client, userId, "product_unsaved", analytics);
      }
      return { outcome: result };
    }

    const result = await saveProduct(client, userId, {
      productId: product.id,
      source: context.source,
      outfitId: context.outfitId,
      postItemId: context.postItemId,
    });
    if (result === "unavailable") {
      queryClient.setQueryData<SavedProductsState>(queryKey, { status: "unavailable" });
    } else if (result === "saved") {
      void trackEvent(client, userId, "product_saved", analytics);
    }
    return { outcome: result };
  } catch (error) {
    if (previous) queryClient.setQueryData<SavedProductsState>(queryKey, previous);
    return { outcome: "failed", error };
  } finally {
    // Swap the optimistic row for the server's (snapshot, live state) either way.
    void queryClient.invalidateQueries({ queryKey });
  }
}
