import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// ConciergeChat needs a live session, server functions and storage to render
// under bun:test, so its retry guarantees are pinned against the source, the
// same way dashboard.test.ts pins its handlers.
const source = readFileSync(new URL("./concierge-chat.tsx", import.meta.url), "utf8");

describe("retrying a failed photo message keeps its photo (MM-10)", () => {
  test("the retry path reads the attachment from the message, not the composer", () => {
    expect(source).toContain("original?.attachment ?? null");
    // The bug: `attached` resolved to null on every retry, so the payload
    // lost the photo while the bubble kept showing its thumbnail.
    expect(source).not.toContain("retryId == null ? attachment : null");
  });

  test("an upload that already succeeded is reused instead of repeated", () => {
    expect(source).toContain("let uploadedUrl: string | null = original?.uploadedUrl ?? null;");
    expect(source).toContain("{ ...m, uploadedUrl }");
  });

  test("the message itself carries the attachment for later retries", () => {
    expect(source).toContain("attachment: attached,");
  });
});
