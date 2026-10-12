import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import type { PostItem } from "@/lib/outfit-items";
import { prefetchSimilarItems, similarItemsQueryOptions, similarShopView } from "./similar-items";

const item = {
  id: "55555555-5555-4555-8555-555555555555",
  attributes: { primary_color: "gold", silhouette_tags: [] },
} as unknown as PostItem;

function spy() {
  const calls: unknown[] = [];
  const fn = (async (arg: unknown) => {
    calls.push(arg);
    return [];
  }) as never;
  return { calls, fn };
}

describe("prefetchSimilarItems", () => {
  test("with the profile still pending, nothing is fetched", async () => {
    const { calls, fn } = spy();
    await prefetchSimilarItems(new QueryClient(), item, fn, { region: undefined, settled: false });
    expect(calls).toEqual([]);
  });

  test("once the profile settles with a country, exactly one fetch carries it, under a regioned key", async () => {
    const qc = new QueryClient();
    const { calls, fn } = spy();
    await prefetchSimilarItems(qc, item, fn, { region: "PH", settled: true });
    await prefetchSimilarItems(qc, item, fn, { region: "PH", settled: true });
    expect(calls).toEqual([{ data: { attributes: item.attributes, region: "PH" } }]);
    expect(qc.getQueryData<unknown[]>(queryKeys.similarItems(item.id, "PH"))).toEqual([]);
    expect(qc.getQueryData(queryKeys.similarItems(item.id, null))).toBeUndefined();
  });

  test("a profile error fetches without a region", async () => {
    const { calls, fn } = spy();
    await prefetchSimilarItems(new QueryClient(), item, fn, { region: undefined, settled: true });
    expect(calls).toEqual([{ data: { attributes: item.attributes, region: undefined } }]);
  });

  test("no item, no fetch", async () => {
    const { calls, fn } = spy();
    await prefetchSimilarItems(new QueryClient(), null, fn, { region: "PH", settled: true });
    expect(calls).toEqual([]);
  });
});

describe("similarItemsQueryOptions", () => {
  test("is enabled only once the profile has settled, and keys on the region", () => {
    const { fn } = spy();
    const pending = similarItemsQueryOptions(item, fn, { region: undefined, settled: false });
    const ready = similarItemsQueryOptions(item, fn, { region: "PH", settled: true });
    expect(pending.enabled).toBe(false);
    expect(ready.enabled).toBe(true);
    expect(ready.queryKey).toEqual(queryKeys.similarItems(item.id, "PH"));
    expect(pending.queryKey).not.toEqual(ready.queryKey);
  });
});

describe("similarShopView", () => {
  test("loading until settled, whatever the query says", () => {
    expect(similarShopView({ settled: false, status: "pending", count: 0 })).toBe("loading");
  });
  test("loading while the enabled query is pending", () => {
    expect(similarShopView({ settled: true, status: "pending", count: 0 })).toBe("loading");
  });
  test("error only on error", () => {
    expect(similarShopView({ settled: true, status: "error", count: 0 })).toBe("error");
  });
  test("empty only on success with zero results", () => {
    expect(similarShopView({ settled: true, status: "success", count: 0 })).toBe("empty");
    expect(similarShopView({ settled: true, status: "success", count: 2 })).toBe("results");
  });
});
