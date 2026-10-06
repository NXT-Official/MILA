import { describe, expect, test } from "bun:test";
import { conciergeAccess } from "./concierge-access";

describe("conciergeAccess", () => {
  test("a member on a plan has concierge access included", () => {
    expect(conciergeAccess({ hasPlan: true, credits: 0 })).toEqual({
      headline: "Included",
      caption: "With your plan",
    });
  });

  test("a member on a plan keeps access on a day they have used every credit", () => {
    expect(conciergeAccess({ hasPlan: true, credits: 0 }).headline).toBe("Included");
  });

  test("a free member holding credits can use the concierge until they run out", () => {
    expect(conciergeAccess({ hasPlan: false, credits: 5 })).toEqual({
      headline: "On credits",
      caption: "While they last",
    });
  });

  test("a free member with no credits is told it is for members, not that they have it", () => {
    expect(conciergeAccess({ hasPlan: false, credits: 0 })).toEqual({
      headline: "Members only",
      caption: "Not on the Free tier",
    });
  });

  test("credits that have not loaded yet read as none", () => {
    expect(conciergeAccess({ hasPlan: false, credits: null }).headline).toBe("Members only");
  });
});
