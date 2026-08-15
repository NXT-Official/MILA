import { describe, expect, test } from "bun:test";
import { DIAGRAM_COVERAGE } from "@/components/style-profile/diagrams";
import { BODIES, FACE_SHAPES, HAIR_TYPES, SEASONS } from "./data";
import {
  HAIR_DIRECTION,
  MAKEUP_HARMONY,
  SILHOUETTE_STRATEGY,
  TEXTILE_DIRECTION,
  type Directive,
} from "./dna";

/**
 * The dossier picks directives and diagrams by attribute value. A value with no
 * entry doesn't throw — the card quietly drops to its fallback and the member
 * gets nothing. These assertions are what makes adding an enum value fail loudly.
 */

const HEX = /^#[0-9A-Fa-f]{6}$/;

function expectUsableDirective(d: Directive | undefined, where: string) {
  expect(d, where).toBeDefined();
  expect(d!.items.length, `${where} has items`).toBeGreaterThan(0);
  expect(d!.note.length, `${where} has a note`).toBeGreaterThan(0);
  for (const item of d!.items) {
    expect(item.term.length, `${where} term is named`).toBeGreaterThan(0);
    // The definition is the whole point of the tappable chip — an empty one
    // ships a tap target that explains nothing.
    expect(item.definition.length, `${where} · ${item.term} is defined`).toBeGreaterThan(10);
    if (item.hex !== undefined) expect(item.hex, `${where} · ${item.term}`).toMatch(HEX);
  }
}

describe("directive coverage", () => {
  test("every body type has a silhouette strategy", () => {
    for (const body of BODIES) expectUsableDirective(SILHOUETTE_STRATEGY[body], body);
  });

  test("every hair type has a hair direction", () => {
    for (const hair of HAIR_TYPES) expectUsableDirective(HAIR_DIRECTION[hair], hair);
  });

  test("every season has makeup and textile directions", () => {
    for (const season of SEASONS) {
      expectUsableDirective(MAKEUP_HARMONY[season], `${season} makeup`);
      expectUsableDirective(TEXTILE_DIRECTION[season], `${season} textile`);
    }
  });

  test("every makeup term carries a swatch — this is a colour app", () => {
    for (const season of SEASONS) {
      for (const item of MAKEUP_HARMONY[season].items) {
        expect(item.hex, `${season} · ${item.term}`).toMatch(HEX);
      }
    }
  });
});

describe("diagram coverage", () => {
  test("every enumerated shape value has a drawing", () => {
    for (const [kind, { values, paths }] of Object.entries(DIAGRAM_COVERAGE)) {
      for (const value of values) {
        expect(Object.keys(paths), `${kind} covers ${value}`).toContain(value);
      }
    }
  });

  test("the enums the diagrams claim to cover are the ones the dossier uses", () => {
    expect(DIAGRAM_COVERAGE.silhouette.values).toEqual(BODIES);
    expect(DIAGRAM_COVERAGE.face.values).toEqual(FACE_SHAPES);
    expect(DIAGRAM_COVERAGE.hair.values).toEqual(HAIR_TYPES);
  });
});
