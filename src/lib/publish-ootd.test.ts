import { describe, expect, test } from "bun:test";
import { TimeoutError } from "@/lib/utils";
import { detectOotdItems, OOTD_DETECTION_TIMEOUT_MS, publishOotd } from "./publish-ootd";
import type { PostItem } from "./outfit-items";

const ITEM: PostItem = {
  id: "item-1",
  label: "Denim jacket",
  category: "outerwear",
  attributes: {} as PostItem["attributes"],
  bbox: { x: 0, y: 0, width: 1, height: 1 } as PostItem["bbox"],
  source_url: null,
};

function harness(overrides: { detectItems?: PostItem[]; detectError?: Error } = {}) {
  const calls: string[] = [];
  const deps = {
    upload: async (path: string) => {
      calls.push(`upload:${path.split("/")[1]?.split("-")[0]}`);
      return { error: null };
    },
    createPost: async () => {
      calls.push("createPost");
      return { id: "post-1" };
    },
    detect: async (postId: string) => {
      calls.push(`detect:${postId}`);
      if (overrides.detectError) throw overrides.detectError;
      return overrides.detectItems ?? [ITEM];
    },
  };
  return { calls, deps };
}

const FILE = new File(["x"], "x.jpg", { type: "image/jpeg" });
const base = { userId: "user-1", back: FILE, front: FILE, caption: "" };

describe("publishOotd", () => {
  test("default is unchanged: detection runs and its items come back", async () => {
    const { calls, deps } = harness();
    const result = await publishOotd(base, deps);
    expect(result).toEqual({ postId: "post-1", items: [ITEM] });
    expect(calls.at(-1)).toBe("detect:post-1");
  });

  test("default is unchanged: a detection failure never costs her the post", async () => {
    const { deps } = harness({ detectError: new Error("vision down") });
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(await publishOotd(base, deps)).toEqual({ postId: "post-1", items: [] });
    } finally {
      console.error = quiet;
    }
  });

  test("detect false resolves before detection is called", async () => {
    const { calls, deps } = harness();
    const result = await publishOotd({ ...base, detect: false }, deps);
    expect(result).toEqual({ postId: "post-1", items: [] });
    expect(calls).toContain("createPost");
    expect(calls.some((c) => c.startsWith("detect:"))).toBe(false);
  });

  test("an upload failure still throws, with or without detection", async () => {
    const { deps } = harness();
    const failing = { ...deps, upload: async () => ({ error: { message: "disk full" } }) };
    await expect(publishOotd({ ...base, detect: false }, failing)).rejects.toThrow("disk full");
  });
});

describe("detectOotdItems", () => {
  test("sends the post id and the idempotency key", async () => {
    let seen: unknown;
    const items = await detectOotdItems("post-1", "req-1", {
      call: async (args) => {
        seen = args;
        return [ITEM];
      },
    });
    expect(items).toEqual([ITEM]);
    expect(seen).toEqual({ data: { post_id: "post-1", clientRequestId: "req-1" } });
  });

  test("a call that never answers ends in a TimeoutError", async () => {
    expect(OOTD_DETECTION_TIMEOUT_MS).toBe(150_000);
    await expect(
      detectOotdItems("post-1", "req-1", { call: () => new Promise(() => {}), timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
