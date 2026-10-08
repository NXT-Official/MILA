import { describe, expect, test } from "bun:test";
import {
  initialPaletteState,
  readPaletteState,
  recordShown,
  writePaletteState,
  type PaletteStorage,
} from "./palette-recent";

function memory(
  initial: Record<string, string> = {},
): PaletteStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("palette recent", () => {
  test("keeps five keys; attempt resets on a new local day; broken storage is ignored", () => {
    const storage = memory();
    writePaletteState(
      "u1",
      { dateKey: "2026-10-06", attempt: 4, recent: ["a", "b", "c", "d", "e", "f", "g"] },
      storage,
    );
    expect(storage.data["mila:daily-palette:u1"]).toBeDefined();
    expect(readPaletteState("u1", "2026-10-06", storage)).toEqual({
      dateKey: "2026-10-06",
      attempt: 4,
      recent: ["c", "d", "e", "f", "g"],
    });
    expect(readPaletteState("u1", "2026-10-07", storage)).toEqual({
      dateKey: "2026-10-07",
      attempt: 0,
      recent: ["c", "d", "e", "f", "g"],
    });
    for (const broken of [
      "{not json",
      "null",
      '{"dateKey":5}',
      '{"dateKey":"2026-10-07","attempt":-1,"recent":[]}',
      '{"dateKey":"2026-10-07","attempt":1,"recent":[1]}',
    ]) {
      const s = memory({ "mila:daily-palette:u1": broken });
      expect(readPaletteState("u1", "2026-10-07", s)).toEqual({
        dateKey: "2026-10-07",
        attempt: 0,
        recent: [],
      });
    }
  });

  test("a storage that throws never breaks the card", () => {
    const throwing: PaletteStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPaletteState("u1", "2026-10-07", throwing)).toEqual({
      dateKey: "2026-10-07",
      attempt: 0,
      recent: [],
    });
    expect(() =>
      writePaletteState("u1", { dateKey: "2026-10-07", attempt: 1, recent: [] }, throwing),
    ).not.toThrow();
  });

  test("members do not share state", () => {
    const storage = memory();
    writePaletteState("u1", { dateKey: "2026-10-07", attempt: 2, recent: ["a"] }, storage);
    expect(readPaletteState("u2", "2026-10-07", storage).attempt).toBe(0);
  });
});

describe("palette recent: what is on screen", () => {
  test("recordShown stores today's pick in recent once, so tomorrow cannot repeat it", () => {
    const state = { dateKey: "2026-10-07", attempt: 0, recent: ["a", "b"] };
    const recorded = recordShown(state, "c");
    expect(recorded).toEqual({
      dateKey: "2026-10-07",
      attempt: 0,
      recent: ["a", "b", "c"],
      shown: "c",
    });
    expect(recordShown(recorded, "c")).toBe(recorded);
    const full = recordShown({ dateKey: "d", attempt: 0, recent: ["a", "b", "c", "d", "e"] }, "f");
    expect(full.recent).toEqual(["b", "c", "d", "e", "f"]);
  });

  test("shown survives storage; a new day forgets it but keeps recent", () => {
    const storage = memory();
    writePaletteState(
      "u1",
      { dateKey: "2026-10-07", attempt: 2, recent: ["a", "b"], shown: "b" },
      storage,
    );
    expect(readPaletteState("u1", "2026-10-07", storage).shown).toBe("b");
    const next = readPaletteState("u1", "2026-10-08", storage);
    expect(next.shown).toBeUndefined();
    expect(next.recent).toEqual(["a", "b"]);
    const bad = memory({
      "mila:daily-palette:u1": '{"dateKey":"2026-10-07","attempt":1,"recent":["a"],"shown":5}',
    });
    expect(readPaletteState("u1", "2026-10-07", bad)).toEqual({
      dateKey: "2026-10-07",
      attempt: 0,
      recent: [],
    });
  });

  test("startFresh keeps recent, moves to the next attempt and excludes the trio on screen", () => {
    const stored = { dateKey: "2026-10-07", attempt: 2, recent: ["a", "b"], shown: "b" };
    expect(initialPaletteState(stored, false)).toBe(stored);
    expect(initialPaletteState({ ...stored, recent: ["a", "b"] }, true)).toEqual({
      dateKey: "2026-10-07",
      attempt: 3,
      recent: ["a", "b"],
    });
    expect(
      initialPaletteState({ dateKey: "2026-10-07", attempt: 0, recent: ["x"], shown: "y" }, true),
    ).toEqual({ dateKey: "2026-10-07", attempt: 1, recent: ["x", "y"] });
    expect(initialPaletteState({ dateKey: "2026-10-07", attempt: 0, recent: [] }, true)).toEqual({
      dateKey: "2026-10-07",
      attempt: 1,
      recent: [],
    });
  });
});
