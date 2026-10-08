import { describe, expect, test } from "bun:test";
import { parseDupeAttributes } from "./dupe-spec";
import { FindSimilarItemsInput } from "./dupe-hunter.functions";

const LEGACY = {
  name: "Navy pinstripe coat",
  category: "Outerwear",
  primary_color: "Navy",
  color_undertone: "Cool",
  silhouette_tags: ["double-breasted", "tailored"],
};

describe("parseDupeAttributes", () => {
  test("keeps every valid spec field", () => {
    const parsed = parseDupeAttributes({
      ...LEGACY,
      garment_type: "coat",
      gender_fit: "womenswear",
      formality: "formal",
      closure: "double-breasted",
      pattern: "striped",
      colors: ["navy", "white"],
      length: "knee",
      fabric: "wool blend",
      key_details: ["notch lapels"],
    });
    expect(parsed.garment_type).toBe("coat");
    expect(parsed.formality).toBe("formal");
    expect(parsed.closure).toBe("double-breasted");
    expect(parsed.colors).toEqual(["navy", "white"]);
  });

  test("drops an off-vocabulary spec value without losing the rest", () => {
    const parsed = parseDupeAttributes({ ...LEGACY, garment_type: "cloak", pattern: "striped" });
    expect(parsed.garment_type).toBeUndefined();
    expect(parsed.pattern).toBe("striped");
    expect(parsed.name).toBe("Navy pinstripe coat");
  });

  test("trims an over-long name and list instead of failing the paid hunt", () => {
    const parsed = parseDupeAttributes({
      ...LEGACY,
      name: "n".repeat(150),
      colors: ["navy", "white", "grey", "black", "cream", "red"],
    });
    expect(parsed.name).toHaveLength(100);
    expect(parsed.colors).toHaveLength(4);
  });

  test("an over-long colour is trimmed, not dropped with the whole list", () => {
    const parsed = parseDupeAttributes({ ...LEGACY, colors: ["n".repeat(45), "white"] });
    expect(parsed.colors).toEqual(["n".repeat(40), "white"]);
  });

  test("jewellery, bags and accessories can read as 'not applicable' formality", () => {
    const parsed = parseDupeAttributes({ ...LEGACY, formality: "not applicable" });
    expect(parsed.formality).toBe("not applicable");
  });

  test("still rejects a read missing the legacy fields", () => {
    expect(() => parseDupeAttributes({ name: "Coat" })).toThrow();
  });
});

describe("FindSimilarItemsInput attributes", () => {
  test("accepts stored attributes with no spec fields, as before", () => {
    const parsed = FindSimilarItemsInput.parse({ attributes: LEGACY });
    expect(parsed.attributes.name).toBe("Navy pinstripe coat");
  });

  test("passes valid spec fields through and drops invalid ones instead of a 400", () => {
    const parsed = FindSimilarItemsInput.parse({
      attributes: { ...LEGACY, garment_type: "coat", formality: "black-tie" },
    });
    expect(parsed.attributes.garment_type).toBe("coat");
    expect(parsed.attributes.formality).toBeUndefined();
  });
});
