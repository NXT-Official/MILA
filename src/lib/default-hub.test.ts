import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_HUB_STORAGE_KEY, HUBS } from "@/constants/climate";
import { attemptSaveDefaultHub, hubSaveFollowUp, saveDefaultHubId } from "./default-hub";

const HUB = HUBS[0].id;

type Store = Record<string, string>;
let store: Store;
let storageThrows: boolean;

beforeEach(() => {
  store = {};
  storageThrows = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        if (storageThrows) throw new Error("blocked");
        store[key] = value;
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("saveDefaultHubId", () => {
  test("writes the profile and then the local copy when the save lands", async () => {
    const calls: Array<[string, string]> = [];
    await saveDefaultHubId("user-1", HUB, async (userId, hubId) => {
      calls.push([userId, hubId]);
      return { rows: 1, error: null };
    });
    expect(calls).toEqual([["user-1", HUB]]);
    expect(store[DEFAULT_HUB_STORAGE_KEY]).toBe(HUB);
  });

  test("throws when the database refuses, and leaves the local copy untouched", async () => {
    store[DEFAULT_HUB_STORAGE_KEY] = "previous-hub";
    await expect(
      saveDefaultHubId("user-1", HUB, async () => ({ rows: 0, error: { message: "denied" } })),
    ).rejects.toThrow();
    expect(store[DEFAULT_HUB_STORAGE_KEY]).toBe("previous-hub");
  });

  test("a write that matched no row is a failure, not a success", async () => {
    await expect(
      saveDefaultHubId("user-1", HUB, async () => ({ rows: 0, error: null })),
    ).rejects.toThrow();
    expect(store[DEFAULT_HUB_STORAGE_KEY]).toBeUndefined();
  });

  test("the thrown error carries no raw database text", async () => {
    let message = "";
    try {
      await saveDefaultHubId("user-1", HUB, async () => ({
        rows: 0,
        error: { message: 'new row violates row-level security policy for table "profiles"' },
      }));
    } catch (err) {
      message = err instanceof Error ? err.message : "";
    }
    expect(message).not.toContain("row-level security");
    expect(message).not.toContain("profiles");
  });

  test("with no signed-in user it only keeps the local copy", async () => {
    let called = false;
    await saveDefaultHubId(undefined, HUB, async () => {
      called = true;
      return { rows: 1, error: null };
    });
    expect(called).toBe(false);
    expect(store[DEFAULT_HUB_STORAGE_KEY]).toBe(HUB);
  });

  test("blocked local storage does not fail a save that reached the database", async () => {
    storageThrows = true;
    await saveDefaultHubId("user-1", HUB, async () => ({ rows: 1, error: null }));
  });
});

describe("attemptSaveDefaultHub", () => {
  test("reports ok when the save lands", async () => {
    const out = await attemptSaveDefaultHub("user-1", HUB, async () => ({ rows: 1, error: null }));
    expect(out).toEqual({ ok: true });
  });

  test("reports a failure instead of throwing, so callers cannot claim success", async () => {
    const out = await attemptSaveDefaultHub("user-1", HUB, async () => ({
      rows: 0,
      error: { message: "denied" },
    }));
    expect(out).toEqual({ ok: false });
  });

  test("a rejected request is a failure too", async () => {
    const out = await attemptSaveDefaultHub("user-1", HUB, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(out).toEqual({ ok: false });
  });
});

describe("hubSaveFollowUp", () => {
  test("a save that lands while she is still on the location view goes on to Preferences", () => {
    expect(hubSaveFollowUp(true, true)).toEqual({
      adoptHub: true,
      goToPreferences: true,
      inlineRetry: false,
      toastFailure: false,
    });
  });

  test("a save that lands after she left is kept but does not pull her anywhere", () => {
    expect(hubSaveFollowUp(true, false)).toEqual({
      adoptHub: true,
      goToPreferences: false,
      inlineRetry: false,
      toastFailure: false,
    });
  });

  test("a failure while she is still on the view shows the inline retry", () => {
    expect(hubSaveFollowUp(false, true)).toEqual({
      adoptHub: false,
      goToPreferences: false,
      inlineRetry: true,
      toastFailure: false,
    });
  });

  test("a failure after she left is a toast, not a silent loss and not a stale inline alert", () => {
    expect(hubSaveFollowUp(false, false)).toEqual({
      adoptHub: false,
      goToPreferences: false,
      inlineRetry: false,
      toastFailure: true,
    });
  });
});
