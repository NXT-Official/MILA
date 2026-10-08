import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { savedProductsQueryKey, type SavedProductsState } from "@/lib/queries/saved-products";
import { renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { SavedPiecesAccountRow, SavedPiecesLink } from "./saved-pieces-link";

function withCache(state: SavedProductsState | undefined) {
  const queryClient = new QueryClient();
  if (state) queryClient.setQueryData(savedProductsQueryKey("user-1"), state);
  return queryClient;
}

const READY: SavedProductsState = { status: "ready", items: [] };

/** The opening tag of the first link to /saved, or null. */
function savedLinkTag(markup: string) {
  return markup.match(/<a[^>]*href="\/saved"[^>]*>/)?.[0] ?? null;
}

describe("SavedPiecesLink", () => {
  test("links to /saved with a bookmark icon and visible text", async () => {
    const out = await renderAppMarkup(<SavedPiecesLink />, {
      userId: "user-1",
      queryClient: withCache(READY),
    });
    expect(savedLinkTag(out)).not.toBeNull();
    expect(out).toContain("Saved pieces");
    expect(out).toContain("lucide-bookmark");
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  test("is a 44px touch target and is not hidden on phone widths", async () => {
    const tag = savedLinkTag(
      await renderAppMarkup(<SavedPiecesLink />, {
        userId: "user-1",
        queryClient: withCache(READY),
      }),
    );
    expect(tag).toContain("min-h-11");
    expect(tag).not.toMatch(/(^|\s|")hidden(\s|")/);
    expect(tag).not.toContain("max-md:hidden");
  });

  test("stays hidden while saved pieces are unavailable, unloaded, or signed out", async () => {
    for (const [state, userId] of [
      [{ status: "unavailable" }, "user-1"],
      [undefined, "user-1"],
      [READY, null],
    ] as const) {
      const out = await renderAppMarkup(<SavedPiecesLink />, {
        userId,
        queryClient: withCache(state),
      });
      expect(savedLinkTag(out)).toBeNull();
    }
  });
});

describe("SavedPiecesAccountRow", () => {
  test("is a full-width row: icon, label and chevron, at least 48px tall", async () => {
    const out = await renderAppMarkup(<SavedPiecesAccountRow />, {
      userId: "user-1",
      queryClient: withCache(READY),
    });
    const row = out.match(/<a[^>]*href="\/saved"[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(row).toContain("Saved pieces");
    expect(row.match(/<svg[^>]*aria-hidden="true"/g)?.length).toBe(2);
    expect(row).toContain("min-h-12");
  });

  test("hides with the feature", async () => {
    const out = await renderAppMarkup(<SavedPiecesAccountRow />, {
      userId: "user-1",
      queryClient: withCache({ status: "unavailable" }),
    });
    expect(savedLinkTag(out)).toBeNull();
  });
});
