import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  optimisticSavedProduct,
  savedProductIds,
  savedProductsQueryKey,
  type SaveableProduct,
  type SavedProductsClient,
  type SavedProductsState,
} from "@/lib/queries/saved-products";
import { toggleSavedProduct } from "./saved-product-toggle";

type Result = { error?: { code?: string; message: string } | null; count?: number };

/**
 * Fake supabase client: saved_products calls resolve with `result` once the
 * `gate` promise settles, so a test can look at the cache mid-flight.
 * analytics_events inserts always succeed and are recorded.
 */
function fakeClient(result: Result, gate: Promise<void> = Promise.resolve()) {
  const calls: Array<[string, ...unknown[]]> = [];
  function chainFor(table: string) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "insert", "delete", "eq", "order"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push([`${table}.${method}`, ...args]);
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
      (table === "saved_products" ? gate : Promise.resolve())
        .then(() =>
          table === "saved_products"
            ? { data: null, error: result.error ?? null, count: result.count ?? null }
            : { data: null, error: null, count: null },
        )
        .then(resolve, reject);
    return chain;
  }
  const client = { from: (table: string) => chainFor(table) } as unknown as SavedProductsClient;
  return { client, calls };
}

const USER = "user-1";
const PRODUCT: SaveableProduct = {
  id: "prod-1",
  title: "High Rise Straight Jeans",
  image_url: null,
  affiliate_link: "https://shop.example.com/jeans",
  price: 79,
  currency: "USD",
  category: "Bottoms",
};
const NOW = "2026-10-07T12:00:00Z";

function clientWith(state: SavedProductsState) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(savedProductsQueryKey(USER), state);
  return queryClient;
}

function cached(queryClient: QueryClient) {
  return queryClient.getQueryData<SavedProductsState>(savedProductsQueryKey(USER));
}

describe("toggleSavedProduct: saving", () => {
  test("marks the piece saved before the server answers, then reports success", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { client, calls } = fakeClient({}, gate);
    const queryClient = clientWith({ status: "ready", items: [] });

    const pending = toggleSavedProduct({
      client,
      queryClient,
      userId: USER,
      product: PRODUCT,
      context: { source: "look", outfitId: "o-1" },
      currentlySaved: false,
      now: NOW,
    });
    // Wait until the insert is in flight (held open by the gate), then look.
    while (!calls.some(([name]) => name === "saved_products.insert")) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(savedProductIds(cached(queryClient)).has("prod-1")).toBe(true);

    open();
    expect((await pending).outcome).toBe("saved");
    expect(calls).toContainEqual([
      "analytics_events.insert",
      expect.objectContaining({
        event_name: "product_saved",
        properties: { product_id: "prod-1", source: "look" },
      }),
    ]);
  });

  test("a failed save reverts the bookmark and hands back the error", async () => {
    const { client, calls } = fakeClient({ error: { code: "08006", message: "offline" } });
    const queryClient = clientWith({ status: "ready", items: [] });
    const outcome = await toggleSavedProduct({
      client,
      queryClient,
      userId: USER,
      product: PRODUCT,
      context: { source: "dupe" },
      currentlySaved: false,
      now: NOW,
    });
    expect(outcome.outcome).toBe("failed");
    expect(savedProductIds(cached(queryClient)).has("prod-1")).toBe(false);
    expect(calls.some(([name]) => name === "analytics_events.insert")).toBe(false);
  });

  test("already saved elsewhere still ends saved, with no duplicate analytics", async () => {
    const { client, calls } = fakeClient({ error: { code: "23505", message: "dup" } });
    const queryClient = clientWith({ status: "ready", items: [] });
    const outcome = await toggleSavedProduct({
      client,
      queryClient,
      userId: USER,
      product: PRODUCT,
      context: { source: "dupe" },
      currentlySaved: false,
      now: NOW,
    });
    expect(outcome.outcome).toBe("already_saved");
    expect(savedProductIds(cached(queryClient)).has("prod-1")).toBe(true);
    expect(calls.some(([name]) => name === "analytics_events.insert")).toBe(false);
  });

  test("a missing table flips the cache to unavailable so every Save button hides", async () => {
    const { client } = fakeClient({ error: { code: "PGRST205", message: "no table" } });
    const queryClient = clientWith({ status: "ready", items: [] });
    const outcome = await toggleSavedProduct({
      client,
      queryClient,
      userId: USER,
      product: PRODUCT,
      context: { source: "look" },
      currentlySaved: false,
      now: NOW,
    });
    expect(outcome.outcome).toBe("unavailable");
    expect(cached(queryClient)).toEqual({ status: "unavailable" });
  });
});

describe("toggleSavedProduct: removing", () => {
  const savedState = (): SavedProductsState => ({
    status: "ready",
    items: [optimisticSavedProduct(PRODUCT, { source: "look" }, NOW)],
  });

  test("a counted delete removes it and records the unsave", async () => {
    const { client, calls } = fakeClient({ count: 1 });
    const queryClient = clientWith(savedState());
    const outcome = await toggleSavedProduct({
      client,
      queryClient,
      userId: USER,
      product: PRODUCT,
      context: { source: "look" },
      currentlySaved: true,
      now: NOW,
    });
    expect(outcome.outcome).toBe("removed");
    expect(savedProductIds(cached(queryClient)).has("prod-1")).toBe(false);
    expect(calls).toContainEqual([
      "analytics_events.insert",
      expect.objectContaining({ event_name: "product_unsaved" }),
    ]);
  });

  test("zero rows deleted is reported as not_found and records nothing", async () => {
    const { client, calls } = fakeClient({ count: 0 });
    const queryClient = clientWith(savedState());
    const outcome = await toggleSavedProduct({
      client,
      queryClient,
      userId: USER,
      product: PRODUCT,
      context: { source: "look" },
      currentlySaved: true,
      now: NOW,
    });
    expect(outcome.outcome).toBe("not_found");
    expect(calls.some(([name]) => name === "analytics_events.insert")).toBe(false);
  });

  test("a failed delete puts the bookmark back", async () => {
    const { client } = fakeClient({ error: { code: "08006", message: "offline" } });
    const queryClient = clientWith(savedState());
    const outcome = await toggleSavedProduct({
      client,
      queryClient,
      userId: USER,
      product: PRODUCT,
      context: { source: "look" },
      currentlySaved: true,
      now: NOW,
    });
    expect(outcome.outcome).toBe("failed");
    expect(savedProductIds(cached(queryClient)).has("prod-1")).toBe(true);
  });
});
