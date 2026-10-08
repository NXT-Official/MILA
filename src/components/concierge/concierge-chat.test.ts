import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// ConciergeChat needs a live session, server functions and storage to render
// under bun:test, so its retry guarantees are pinned against the source, the
// same way dashboard.test.ts pins its handlers. The behaviour itself is
// exercised end to end in src/hooks/use-concierge-send.test.ts ("retry keeps
// the photo …").
const source = readFileSync(new URL("./concierge-chat.tsx", import.meta.url), "utf8");

describe("retrying a failed photo message keeps its photo (MM-10)", () => {
  test("the retry path reads the photo kept for that message, not the composer", () => {
    expect(source).toContain("file = keptFiles.current.get(retryId) ?? null;");
    // The bug: `attached` resolved to null on every retry, so the payload
    // lost the photo while the bubble kept showing its thumbnail.
    expect(source).not.toContain("retryId == null ? attachment : null");
  });

  test("an upload that already succeeded is reused instead of repeated", () => {
    expect(source).toContain("uploadedUrl: userMsg.uploadedUrl ?? null,");
    expect(source).toContain("onUploaded: (url) => patch({ uploadedUrl: url }),");
  });

  test("the message keeps its photo for later retries", () => {
    expect(source).toContain("if (file) keptFiles.current.set(userMsg.id, file);");
  });
});
