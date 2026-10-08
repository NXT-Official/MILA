import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import type { PostItem } from "@/lib/outfit-items";
import { renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { SimilarShopNotice, SimilarShopResults } from "./post-item-drawer";

describe("SimilarShopNotice", () => {
  test("shows an honest error with Try again when the search failed", () => {
    const html = renderToStaticMarkup(<SimilarShopNotice isError onRetry={() => undefined} />);
    expect(html).toContain("Try again");
    expect(html).not.toContain("Nothing close");
  });

  test("keeps the empty copy for a real zero-result search", () => {
    const html = renderToStaticMarkup(
      <SimilarShopNotice isError={false} onRetry={() => undefined} />,
    );
    expect(html).toContain("Nothing close");
    expect(html).not.toContain("Try again");
  });
});

describe("SimilarShopNotice retry feedback", () => {
  test("disables the button and says it is searching while the retry runs", () => {
    const html = renderToStaticMarkup(
      <SimilarShopNotice isError isRetrying onRetry={() => undefined} />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Searching again");
  });
});

describe("SimilarShopResults wiring", () => {
  const item = {
    id: "44444444-4444-4444-8444-444444444444",
    label: "Hoops",
    category: "Jewelry",
    bbox: { x: 0, y: 0, w: 0.1, h: 0.1 },
    source_url: null,
    attributes: { primary_color: "gold", silhouette_tags: [] },
  } as unknown as PostItem;

  test("a failed search query reaches the error notice, not the empty copy", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    queryClient
      .getQueryCache()
      .build(queryClient, { queryKey: queryKeys.similarItems(item.id, null) })
      .setState({
        status: "error",
        error: new Error("boom"),
        fetchStatus: "idle",
      } as never);
    const html = await renderAppMarkup(<SimilarShopResults item={item} sort="best_match" />, {
      userId: null,
      queryClient,
    });
    expect(html).toContain("Try again");
    expect(html).not.toContain("Nothing close");
  });

  test("a refetch in flight reaches the notice as isRetrying", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    queryClient
      .getQueryCache()
      .build(queryClient, { queryKey: queryKeys.similarItems(item.id, null) })
      .setState({ status: "error", error: new Error("boom"), fetchStatus: "fetching" } as never);
    const html = await renderAppMarkup(<SimilarShopResults item={item} sort="best_match" />, {
      userId: null,
      queryClient,
    });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Searching again");
  });
});

describe("SimilarShopResults while her profile is pending", () => {
  const item = {
    id: "66666666-6666-4666-8666-666666666666",
    attributes: { primary_color: "gold", silhouette_tags: [] },
  } as unknown as PostItem;

  test("shows the skeleton, never the empty copy", async () => {
    const html = await renderAppMarkup(<SimilarShopResults item={item} sort="best_match" />, {
      userId: "user-1",
    });
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("Nothing close");
    expect(html).not.toContain("Try again");
  });
});
