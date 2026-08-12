import { expect, test } from "bun:test";
import { combosFor } from "./outfit-combos";
import { NAMED_PALETTE } from "@/constants/style-profile";

test("every season yields four three-colour combos drawn from its own palette", () => {
  for (const season of ["Spring", "Summer", "Autumn", "Winter"] as const) {
    const combos = combosFor(season);
    expect(combos).toHaveLength(4);

    const known = new Set(
      [
        ...NAMED_PALETTE[season].primary,
        ...NAMED_PALETTE[season].accents,
        ...NAMED_PALETTE[season].neutrals,
      ].map((s) => s.name),
    );
    for (const c of combos) {
      expect(c.hexes).toHaveLength(3);
      expect(c.names).toHaveLength(3);
      // Naming a colour the member cannot find in the bands above is the bug
      // this guards against.
      for (const name of c.names) expect(known.has(name)).toBe(true);
    }
  }
});

test("hexes and names stay aligned", () => {
  const [first] = combosFor("Summer");
  const primary = NAMED_PALETTE.Summer.primary;
  expect(first!.names[0]).toBe(primary[0]!.name);
  expect(first!.hexes[0]).toBe(primary[0]!.hex);
});
