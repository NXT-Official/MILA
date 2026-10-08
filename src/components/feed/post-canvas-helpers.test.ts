import { describe, expect, test } from "bun:test";
import { avatarNameFor, ootdLabel } from "./post-canvas-helpers";

describe("ootdLabel", () => {
  const now = new Date(2026, 9, 7, 15, 0, 0);

  test("says Today's OOTD only for a post from today in local time", () => {
    expect(ootdLabel(new Date(2026, 9, 7, 0, 5, 0).toISOString(), now)).toBe("Today's OOTD");
  });

  test("uses a date label for an older post", () => {
    const label = ootdLabel(new Date(2026, 9, 5, 12, 0, 0).toISOString(), now);
    expect(label).not.toBe("Today's OOTD");
    expect(label).toContain("Oct");
    expect(label).toContain("5");
  });

  test("a post just before local midnight is not today", () => {
    expect(ootdLabel(new Date(2026, 9, 6, 23, 59, 0).toISOString(), now)).not.toBe("Today's OOTD");
  });

  test("returns an empty label for an unparseable date", () => {
    expect(ootdLabel("nope", now)).toBe("");
  });
});

describe("avatarNameFor", () => {
  test("uses her real name on her own post, not the 'You' display label", () => {
    expect(avatarNameFor({ is_self: true, author_name: "Yara Cole" })).toBe("Yara Cole");
    expect(avatarNameFor({ is_self: true, author_name: "Nicole" })).toBe("Nicole");
  });

  test("falls back to a neutral initial when her name is missing", () => {
    expect(avatarNameFor({ is_self: true, author_name: null })).toBe("Member");
  });

  test("other members use their name or Member", () => {
    expect(avatarNameFor({ is_self: false, author_name: " Ana " })).toBe("Ana");
    expect(avatarNameFor({ is_self: false, author_name: null })).toBe("Member");
  });
});
