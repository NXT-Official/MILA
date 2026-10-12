import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { createFeaturePressKeys, featureMutationKey } from "@/lib/queries/feature-jobs";
import { TimeoutError } from "@/lib/utils";
import type { PostItem } from "@/lib/outfit-items";
import {
  isDetectionInFlight,
  isUnknownOutcome,
  ootdDetectionKey,
  ootdDetectionMutationOptions,
  runOotdDetection,
} from "./use-ootd-detection";

const ITEM = { id: "item-1", label: "Denim jacket" } as PostItem;
const STILL_FINISHING = "Mila is still finishing your last request. Try again in a moment.";

function keys() {
  let n = 0;
  return createFeaturePressKeys(() => `id-${(n += 1)}`);
}

describe("runOotdDetection", () => {
  test("one post never sends two ids", async () => {
    const sent: string[] = [];
    const pressKeys = keys();
    const detect = async (_postId: string, id: string) => {
      sent.push(id);
      return [ITEM];
    };
    const base = { userId: "u1", detect, pressKeys, mounted: () => true, sleep: async () => {} };
    // Two presses for one post that are both unsettled share one key.
    await Promise.all([
      runOotdDetection({ ...base, postId: "post-1" }),
      runOotdDetection({ ...base, postId: "post-1" }),
    ]);
    expect(sent).toEqual(["id-1", "id-1"]);
  });

  test("a lost answer resends the same id", async () => {
    const sent: string[] = [];
    let calls = 0;
    const detect = async (_postId: string, id: string) => {
      sent.push(id);
      calls += 1;
      if (calls === 1) throw new TimeoutError();
      return [ITEM];
    };
    const pressKeys = keys();
    const args = { userId: "u1", postId: "post-1", detect, pressKeys, mounted: () => true };
    await expect(runOotdDetection({ ...args, sleep: async () => {} })).rejects.toBeInstanceOf(
      TimeoutError,
    );
    await expect(runOotdDetection({ ...args, sleep: async () => {} })).resolves.toEqual([ITEM]);
    expect(sent).toEqual(["id-1", "id-1"]);
  });

  test("a real server answer retires the id, so a later press is a new request", async () => {
    const sent: string[] = [];
    const detect = async (_postId: string, id: string) => {
      sent.push(id);
      return [ITEM];
    };
    const pressKeys = keys();
    const args = { userId: "u1", postId: "post-1", detect, pressKeys, mounted: () => true };
    await runOotdDetection({ ...args, sleep: async () => {} });
    await runOotdDetection({ ...args, sleep: async () => {} });
    expect(sent).toEqual(["id-1", "id-2"]);
  });

  test("a refusal that is not a lost answer retires the id and rethrows", async () => {
    const pressKeys = keys();
    const detect = async () => {
      throw new Error("Post not found.");
    };
    const args = { userId: "u1", postId: "post-1", detect, pressKeys, mounted: () => true };
    await expect(runOotdDetection({ ...args, sleep: async () => {} })).rejects.toThrow(
      "Post not found.",
    );
    expect(pressKeys.keyFor("u1", "item_detection", '{"postId":"post-1"}')).toBe("id-2");
  });

  test("a 429 is retried once, with the same id, after the wait", async () => {
    const sent: string[] = [];
    const waits: number[] = [];
    let calls = 0;
    const detect = async (_postId: string, id: string) => {
      sent.push(id);
      calls += 1;
      if (calls === 1) throw Object.assign(new Error(STILL_FINISHING), { retryAfterSeconds: 4 });
      return [ITEM];
    };
    const result = await runOotdDetection({
      userId: "u1",
      postId: "post-1",
      detect,
      pressKeys: keys(),
      mounted: () => true,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(result).toEqual([ITEM]);
    expect(sent).toEqual(["id-1", "id-1"]);
    expect(waits).toEqual([4_000]);
  });

  test("a second 429 stays silent: it rejects once more and is not retried again", async () => {
    let calls = 0;
    const detect = async () => {
      calls += 1;
      throw new Error(STILL_FINISHING);
    };
    await expect(
      runOotdDetection({
        userId: "u1",
        postId: "post-1",
        detect,
        pressKeys: keys(),
        mounted: () => true,
        sleep: async () => {},
      }),
    ).rejects.toThrow(STILL_FINISHING);
    expect(calls).toBe(2);
  });

  test("a 429 is not retried once the page is gone", async () => {
    let calls = 0;
    const detect = async () => {
      calls += 1;
      throw new Error(STILL_FINISHING);
    };
    await expect(
      runOotdDetection({
        userId: "u1",
        postId: "post-1",
        detect,
        pressKeys: keys(),
        mounted: () => false,
        sleep: async () => {},
      }),
    ).rejects.toThrow(STILL_FINISHING);
    expect(calls).toBe(1);
  });

  test("the wait is bounded, whatever the server says", async () => {
    const waits: number[] = [];
    let calls = 0;
    const detect = async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error(STILL_FINISHING), { retryAfterSeconds: 9999 });
      return [];
    };
    await runOotdDetection({
      userId: "u1",
      postId: "post-1",
      detect,
      pressKeys: keys(),
      mounted: () => true,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits[0]).toBeLessThanOrEqual(30_000);
  });
});

describe("isDetectionInFlight", () => {
  test("recognises the server's still-finishing answer only", () => {
    expect(isDetectionInFlight(new Error(STILL_FINISHING))).toBe(true);
    expect(isDetectionInFlight(new Error("Post not found."))).toBe(false);
    expect(isDetectionInFlight(null)).toBe(false);
  });
});

describe("ootdDetectionMutationOptions", () => {
  test("uses the item_detection key, never retries and never pauses", () => {
    const options = ootdDetectionMutationOptions(new QueryClient(), async () => [ITEM]);
    expect(options.mutationKey).toEqual(featureMutationKey("item_detection"));
    expect(options.retry).toBe(false);
    expect(options.networkMode).toBe("always");
  });

  test("onSuccess writes her items to the detection cache", () => {
    const queryClient = new QueryClient();
    const options = ootdDetectionMutationOptions(queryClient, async () => [ITEM]);
    options.onSuccess([ITEM], { userId: "u1", postId: "post-1" });
    expect(queryClient.getQueryData(ootdDetectionKey("u1", "post-1"))).toEqual({ items: [ITEM] });
  });

  test("onSettled refreshes the feed as well as credits and jobs", () => {
    const invalidated: unknown[] = [];
    const queryClient = {
      invalidateQueries: (filters: { queryKey: unknown }) => {
        invalidated.push(filters.queryKey);
        return Promise.resolve();
      },
    } as unknown as QueryClient;
    const options = ootdDetectionMutationOptions(queryClient, async () => [ITEM]);
    options.onSettled([ITEM], null, { userId: "u1", postId: "post-1" });
    expect(invalidated).toContainEqual(queryKeys.feed("u1"));
    expect(invalidated).toContainEqual(queryKeys.credits("u1"));
  });
});

describe("an unknown outcome keeps the id", () => {
  const unknowns: [string, unknown][] = [
    [
      "a body that is not JSON",
      new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON"),
    ],
    ["a bare 502", new Error("502 Bad Gateway")],
    ["a gateway timeout", new Error("Gateway Timeout")],
    ["an HTML error page", new Error("<!DOCTYPE html><html>")],
    ["a thrown non-Error", "boom"],
    ["an empty message", new Error("")],
  ];
  for (const [name, error] of unknowns) {
    test(`${name} is unknown and the next press reuses the id`, async () => {
      expect(isUnknownOutcome(error)).toBe(true);
      const sent: string[] = [];
      let calls = 0;
      const detect = async (_p: string, id: string) => {
        sent.push(id);
        calls += 1;
        if (calls === 1) throw error;
        return [ITEM];
      };
      const args = {
        userId: "u1",
        postId: "post-1",
        detect,
        pressKeys: keys(),
        mounted: () => true,
        sleep: async () => {},
      };
      await runOotdDetection(args).catch(() => {});
      await runOotdDetection(args);
      expect(sent).toEqual(["id-1", "id-1"]);
    });
  }

  test("a real refusal is not unknown", () => {
    expect(isUnknownOutcome(new Error("Post not found."))).toBe(false);
  });
});

describe("fresh", () => {
  function twoRuns(second: { fresh?: boolean }) {
    const sent: string[] = [];
    let calls = 0;
    const detect = async (_p: string, id: string) => {
      sent.push(id);
      calls += 1;
      if (calls === 1) throw new TimeoutError();
      return [ITEM];
    };
    const args = {
      userId: "u1",
      postId: "post-1",
      detect,
      pressKeys: keys(),
      mounted: () => true,
      sleep: async () => {},
    };
    return runOotdDetection(args)
      .catch(() => {})
      .then(() => runOotdDetection({ ...args, ...second }))
      .then(() => sent);
  }

  test("a plain start after a lost answer keeps the id", async () => {
    expect(await twoRuns({})).toEqual(["id-1", "id-1"]);
  });

  test("fresh mints a new id after a lost answer", async () => {
    expect(await twoRuns({ fresh: true })).toEqual(["id-1", "id-2"]);
  });
});

describe("429 is found by its shape first", () => {
  test("by name", () => {
    const e = new Error("anything");
    e.name = "GenerationInFlightError";
    expect(isDetectionInFlight(e)).toBe(true);
  });
  test("by status code 429 with the in-flight message", () => {
    expect(isDetectionInFlight(Object.assign(new Error("x"), { statusCode: 429 }))).toBe(true);
  });
  test("a plain rate limit is not retried", () => {
    const e = Object.assign(new Error("Too many requests"), {
      name: "RateLimitExceededError",
      statusCode: 429,
    });
    expect(isDetectionInFlight(e)).toBe(false);
  });
  test("the message alone still works as a fallback", () => {
    expect(isDetectionInFlight(new Error(STILL_FINISHING))).toBe(true);
  });
});
