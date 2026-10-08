import { describe, expect, test } from "bun:test";
import {
  groupSavedByKind,
  isFeatureUnavailableError,
  isPendingSave,
  removeTarget,
  listSavedProducts,
  optimisticSavedProduct,
  saveProduct,
  savedAvailability,
  savedProductIds,
  unsaveProduct,
  withSavedProduct,
  withoutSavedProduct,
  type SavedProduct,
  type SavedProductsClient,
  type SavedProductsState,
} from "./saved-products";

type Result = { data?: unknown; error?: { code?: string; message: string } | null; count?: number };

/**
 * A stand-in for the supabase client: records every builder call on the
 * saved_products table and resolves the awaited chain with `result`.
 */
function fakeClient(result: Result) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "delete", "eq", "order"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    }).then(resolve, reject);
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
  } as unknown as SavedProductsClient;
  return { client, calls };
}

const MISSING_TABLE = {
  code: "PGRST205",
  message: "Could not find the table 'public.saved_products' in the schema cache",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    product_id: "prod-1",
    source: "look",
    outfit_id: null,
    post_item_id: null,
    created_at: "2026-10-07T10:00:00Z",
    snapshot: {
      title: "High Rise Straight Jeans",
      image_url: "https://cdn.example.com/jeans.jpg",
      product_url: "https://shop.example.com/jeans",
      price: 79,
      currency: "USD",
      category: "Bottoms",
      brand: "Example Denim",
    },
    products: {
      in_stock: true,
      verification_status: "verified",
      affiliate_link: "https://shop.example.com/jeans?ref=mila",
    },
    ...overrides,
  };
}

describe("isFeatureUnavailableError", () => {
  test("a table that is not there yet means the feature is unavailable", () => {
    expect(isFeatureUnavailableError({ code: "PGRST205", message: "" })).toBe(true);
    expect(isFeatureUnavailableError({ code: "42P01", message: "" })).toBe(true);
  });

  test("anything else is a real error", () => {
    expect(isFeatureUnavailableError({ code: "42501", message: "" })).toBe(false);
    expect(isFeatureUnavailableError({ code: "23505", message: "" })).toBe(false);
    expect(isFeatureUnavailableError(null)).toBe(false);
  });
});

describe("listSavedProducts", () => {
  test("reads the member's own rows newest first, with the live catalog state", async () => {
    const { client, calls } = fakeClient({ data: [row()] });
    const state = await listSavedProducts(client, "user-1");
    expect(calls[0]).toEqual(["from", "saved_products"]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    const select = calls.find(([m]) => m === "select")?.[1] as string;
    expect(select).toContain("snapshot");
    expect(select).toContain("products(in_stock,verification_status,affiliate_link)");

    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      id: "row-1",
      product_id: "prod-1",
      source: "look",
      snapshot: { title: "High Rise Straight Jeans", price: 79, brand: "Example Denim" },
      live: { in_stock: true, verification_status: "verified" },
    });
  });

  test("a missing table becomes the typed unavailable state, never a throw", async () => {
    const { client } = fakeClient({ error: MISSING_TABLE });
    expect(await listSavedProducts(client, "user-1")).toEqual({ status: "unavailable" });
  });

  test("any other failure is thrown so the page can offer a retry", async () => {
    const { client } = fakeClient({ error: { code: "08006", message: "connection failure" } });
    await expect(listSavedProducts(client, "user-1")).rejects.toMatchObject({ code: "08006" });
  });

  test("a deleted product keeps its snapshot and has no live state", async () => {
    const { client } = fakeClient({ data: [row({ product_id: null, products: null })] });
    const state = await listSavedProducts(client, "user-1");
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.items[0].live).toBeNull();
    expect(state.items[0].snapshot.title).toBe("High Rise Straight Jeans");
  });

  test("a malformed snapshot still renders as a calm placeholder", async () => {
    const { client } = fakeClient({ data: [row({ snapshot: "not an object", source: "x" })] });
    const state = await listSavedProducts(client, "user-1");
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.items[0].snapshot).toEqual({
      title: "Saved piece",
      image_url: null,
      product_url: null,
      price: null,
      currency: null,
      category: null,
      brand: null,
    });
    expect(state.items[0].source).toBe("look");
  });
});

describe("saveProduct", () => {
  test("inserts the member's row with its context; the snapshot is left to the database", async () => {
    const { client, calls } = fakeClient({});
    const result = await saveProduct(client, "user-1", {
      productId: "prod-1",
      source: "post_item",
      postItemId: "pi-1",
    });
    expect(result).toBe("saved");
    expect(calls).toContainEqual([
      "insert",
      {
        user_id: "user-1",
        product_id: "prod-1",
        source: "post_item",
        outfit_id: null,
        post_item_id: "pi-1",
        snapshot: {},
      },
    ]);
  });

  test("a duplicate (23505) means it was already saved, which is success", async () => {
    const { client } = fakeClient({ error: { code: "23505", message: "duplicate key" } });
    expect(await saveProduct(client, "user-1", { productId: "prod-1", source: "look" })).toBe(
      "already_saved",
    );
  });

  test("a missing table reports unavailable instead of throwing", async () => {
    const { client } = fakeClient({ error: MISSING_TABLE });
    expect(await saveProduct(client, "user-1", { productId: "prod-1", source: "dupe" })).toBe(
      "unavailable",
    );
  });

  test("a refused write (RLS) is thrown so the UI can revert", async () => {
    const { client } = fakeClient({ error: { code: "42501", message: "row-level security" } });
    await expect(
      saveProduct(client, "user-1", { productId: "prod-1", source: "look", outfitId: "o-1" }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("unsaveProduct", () => {
  test("deletes by product for this member and asks for an exact count", async () => {
    const { client, calls } = fakeClient({ count: 1 });
    expect(await unsaveProduct(client, "user-1", { productId: "prod-1" })).toBe("removed");
    expect(calls).toContainEqual(["delete", { count: "exact" }]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["eq", "product_id", "prod-1"]);
  });

  test("can delete by saved row id, for pieces whose product is gone", async () => {
    const { client, calls } = fakeClient({ count: 1 });
    expect(await unsaveProduct(client, "user-1", { savedId: "row-1" })).toBe("removed");
    expect(calls).toContainEqual(["eq", "id", "row-1"]);
  });

  test("zero deleted rows is not an error, and not a removal either", async () => {
    const { client } = fakeClient({ count: 0 });
    expect(await unsaveProduct(client, "user-1", { productId: "prod-1" })).toBe("not_found");
  });

  test("an unknown count is never reported as a removal", async () => {
    const { client } = fakeClient({});
    expect(await unsaveProduct(client, "user-1", { productId: "prod-1" })).toBe("not_found");
  });

  test("a missing table reports unavailable; other errors throw", async () => {
    expect(
      await unsaveProduct(fakeClient({ error: MISSING_TABLE }).client, "user-1", {
        productId: "prod-1",
      }),
    ).toBe("unavailable");
    await expect(
      unsaveProduct(fakeClient({ error: { code: "08006", message: "down" } }).client, "user-1", {
        productId: "prod-1",
      }),
    ).rejects.toMatchObject({ code: "08006" });
  });
});

describe("optimistic state helpers", () => {
  const ready = (items: SavedProduct[]): SavedProductsState => ({ status: "ready", items });
  const pending = optimisticSavedProduct(
    {
      id: "prod-2",
      title: "Satin Evening Clutch",
      image_url: null,
      affiliate_link: "https://shop.example.com/clutch",
      price: 45,
      currency: "USD",
      category: "Accessories",
    },
    { source: "dupe" },
    "2026-10-07T11:00:00Z",
  );

  test("savedProductIds is a fast lookup of saved product ids, skipping deleted products", () => {
    const ids = savedProductIds(ready([pending, { ...pending, id: "gone", product_id: null }]));
    expect(ids.has("prod-2")).toBe(true);
    expect(ids.size).toBe(1);
    expect(savedProductIds({ status: "unavailable" }).size).toBe(0);
    expect(savedProductIds(undefined).size).toBe(0);
  });

  test("an optimistic save goes to the top, once", () => {
    const next = withSavedProduct(ready([]), pending);
    expect(next).toEqual(ready([pending]));
    expect(withSavedProduct(next, pending)).toEqual(next);
  });

  test("an optimistic unsave drops the product", () => {
    expect(withoutSavedProduct(ready([pending]), "prod-2")).toEqual(ready([]));
  });

  test("helpers leave the unavailable state alone", () => {
    expect(withSavedProduct({ status: "unavailable" }, pending)).toEqual({
      status: "unavailable",
    });
    expect(withoutSavedProduct(undefined, "prod-2")).toBeUndefined();
  });
});

describe("groupSavedByKind", () => {
  function saved(id: string, category: string, title: string): SavedProduct {
    return {
      ...optimisticSavedProduct(
        {
          id,
          title,
          image_url: null,
          affiliate_link: "https://shop.example.com/x",
          price: 10,
          currency: "USD",
          category,
        },
        { source: "look" },
        "2026-10-07T11:00:00Z",
      ),
      id: `row-${id}`,
    };
  }

  test("groups head to toe, keeps newest-first order inside a group, skips empty kinds", () => {
    const groups = groupSavedByKind([
      saved("a", "Shoes", "Leather Ankle Boots"),
      saved("b", "Tops", "Oxford Shirt"),
      saved("c", "Accessories", "Satin Evening Clutch"),
      saved("d", "Tops", "Merino Sweater"),
      saved("e", "Swimwear", "Ribbed Bikini"),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["top", "shoes", "bag", "unknown"]);
    expect(groups.map((g) => g.heading)).toEqual(["Tops", "Shoes", "Bags", "Other pieces"]);
    expect(groups[0].items.map(({ item }) => item.product_id)).toEqual(["b", "d"]);
    expect(groups[0].items[1].garment).toEqual({ kind: "top", label: "Sweater" });
    expect(groups[2].items[0].garment).toEqual({ kind: "bag", label: "Clutch" });
  });

  test("no items, no groups", () => {
    expect(groupSavedByKind([])).toEqual([]);
  });
});

describe("a piece saved a moment ago (optimistic row)", () => {
  const justSaved = optimisticSavedProduct(
    {
      id: "prod-9",
      title: "Oxford Shirt",
      image_url: null,
      affiliate_link: "https://shop.example.com/oxford",
      price: 59,
      currency: "USD",
      category: "Tops",
      verification_status: "verified",
    },
    { source: "look" },
    "2026-10-07T11:00:00Z",
  );

  test("shows as available with its shop link, not as gone", () => {
    expect(savedAvailability(justSaved)).toBe("available");
    expect(justSaved.live).toEqual({
      in_stock: true,
      verification_status: "verified",
      affiliate_link: "https://shop.example.com/oxford",
    });
  });

  test("a card without a verification status is honest about it", () => {
    const { verification_status: _omitted, ...withoutStatus } = {
      id: "prod-10",
      title: "Tee",
      image_url: null,
      affiliate_link: "https://shop.example.com/tee",
      price: 20,
      currency: "USD",
      category: "Tops",
      verification_status: "verified",
    };
    const row = optimisticSavedProduct(withoutStatus, { source: "dupe" }, "2026-10-07T11:00:00Z");
    expect(row.live?.verification_status).toBe("unverified");
    expect(savedAvailability(row)).toBe("available");
  });

  test("is marked pending until the server's row replaces it", () => {
    expect(isPendingSave(justSaved)).toBe(true);
    expect(isPendingSave({ ...justSaved, id: "6f1c5c2e-0000-4000-8000-000000000001" })).toBe(false);
  });

  test("removing it targets the product, never the temporary id the database never saw", () => {
    expect(removeTarget(justSaved)).toEqual({ productId: "prod-9" });
    expect(removeTarget({ ...justSaved, id: "row-1" })).toEqual({ savedId: "row-1" });
    // A server row whose product is gone is removed by its own id.
    expect(removeTarget({ ...justSaved, id: "row-2", product_id: null })).toEqual({
      savedId: "row-2",
    });
  });
});

describe("savedAvailability", () => {
  const base = optimisticSavedProduct(
    {
      id: "prod-1",
      title: "Jeans",
      image_url: null,
      affiliate_link: "https://shop.example.com/j",
      price: 79,
      currency: "USD",
      category: "Bottoms",
    },
    { source: "look" },
    "2026-10-07T11:00:00Z",
  );

  test("a live, in-stock product with a working link can be shopped", () => {
    expect(
      savedAvailability({
        ...base,
        live: { in_stock: true, verification_status: "verified", affiliate_link: "x" },
      }),
    ).toBe("available");
  });

  test("a deleted product is no longer available", () => {
    expect(savedAvailability({ ...base, product_id: null, live: null })).toBe("gone");
    expect(savedAvailability({ ...base, live: null })).toBe("gone");
  });

  test("a broken link and an out-of-stock product are told apart", () => {
    expect(
      savedAvailability({
        ...base,
        live: { in_stock: true, verification_status: "broken", affiliate_link: "x" },
      }),
    ).toBe("link_unavailable");
    expect(
      savedAvailability({
        ...base,
        live: { in_stock: false, verification_status: "verified", affiliate_link: "x" },
      }),
    ).toBe("out_of_stock");
  });
});
