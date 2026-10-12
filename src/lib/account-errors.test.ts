import { describe, expect, test } from "bun:test";
import { runMembershipAction } from "./account-errors";

describe("runMembershipAction", () => {
  test("passes a success result through", async () => {
    const out = await runMembershipAction("cancel", async () => ({
      success: true as const,
      endsAt: "2026-12-01T00:00:00.000Z",
    }));
    expect(out).toEqual({
      ok: true,
      value: { success: true, endsAt: "2026-12-01T00:00:00.000Z" },
    });
  });

  test("keeps the server's own friendly error text", async () => {
    const out = await runMembershipAction("resume", async () => ({
      error: "Couldn't renew your membership. Try again in a moment.",
    }));
    expect(out).toEqual({
      ok: false,
      message: "Couldn't renew your membership. Try again in a moment.",
    });
  });

  test("a thrown network failure becomes calm cancel copy, never the raw error", async () => {
    const out = await runMembershipAction("cancel", async () => {
      throw new TypeError("Failed to fetch https://internal.example/_serverFn/abc123");
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toBe(
      "We couldn't cancel your membership just now. Nothing has changed. Please try again.",
    );
    expect(out.message).not.toContain("fetch");
  });

  test("a thrown failure becomes calm resume copy", async () => {
    const out = await runMembershipAction("resume", async () => {
      throw new Error("boom");
    });
    expect(out).toEqual({
      ok: false,
      message: "We couldn't renew your membership just now. Nothing has changed. Please try again.",
    });
  });

  test("a stale tab is told to refresh instead of retrying forever", async () => {
    const out = await runMembershipAction("cancel", async () => {
      throw new Error("Server function info not found for abc");
    });
    expect(out).toEqual({
      ok: false,
      message: "Mila was updated while this page was open. Refresh the page and try again.",
    });
  });

  test("a non-Error rejection is still handled", async () => {
    const out = await runMembershipAction("cancel", () => Promise.reject("nope"));
    expect(out.ok).toBe(false);
  });

  test("a synchronous throw inside the action is handled too", async () => {
    const out = await runMembershipAction("cancel", () => {
      throw new Error("sync");
    });
    expect(out.ok).toBe(false);
  });

  test("copy has no em or en dashes", async () => {
    for (const action of ["cancel", "resume"] as const) {
      const out = await runMembershipAction(action, async () => {
        throw new Error("x");
      });
      if (!out.ok) expect(out.message).not.toMatch(/[–—]/);
    }
  });
});
