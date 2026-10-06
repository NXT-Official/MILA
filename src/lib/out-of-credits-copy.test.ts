import { describe, expect, test } from "bun:test";
import { outOfCreditsCopy } from "./out-of-credits-copy";

describe("outOfCreditsCopy", () => {
  test("a member on a plan who has spent today's credits keeps the used-up message", () => {
    expect(outOfCreditsCopy({ hasPlan: true })).toEqual({
      title: "Studio Energy Depleted",
      description:
        "You've used today's styling credits. Move to a membership with a bigger daily allowance.",
    });
  });

  test("a member with no plan is told styling is part of a membership, not that credits ran out", () => {
    const copy = outOfCreditsCopy({ hasPlan: false });
    expect(copy.title).not.toContain("Depleted");
    expect(copy.description).not.toContain("You've used");
    expect(copy.description).toContain("membership");
    expect(copy.description).toContain("every day");
  });
});
