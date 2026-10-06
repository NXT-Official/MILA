import { describe, expect, test } from "bun:test";
import { SEASONS_MASTER_DATA, SEASON_HEX_MATRIX } from "@/constants/style-profile";
import { studioToDossier } from "@/lib/style-profile/studio-dossier";
import { memberBodyType, withChosenBodyType } from "./member-body-type";

describe("memberBodyType — the silhouette she picked always wins", () => {
  test("her pick beats the colour read's guess", () => {
    expect(memberBodyType("Pear", "Hourglass")).toBe("Pear");
  });

  test("the guess only fills in when she hasn't picked one", () => {
    expect(memberBodyType(null, "Hourglass")).toBe("Hourglass");
    expect(memberBodyType("", "Hourglass")).toBe("Hourglass");
  });

  test("values that aren't a silhouette are ignored", () => {
    expect(memberBodyType("Banana", "Rectangle")).toBe("Rectangle");
    expect(memberBodyType(undefined, 42)).toBeNull();
  });
});

describe("withChosenBodyType — a new colour read never overwrites her pick", () => {
  const read = studioToDossier({
    ...SEASONS_MASTER_DATA.SPRING_LIGHT,
    faceShape: "Oval Frame",
    bodyType: "Hourglass",
    stylistNote: "A light, warm canvas.",
    fullPalette: SEASON_HEX_MATRIX.SPRING_LIGHT,
    confidenceScore: 84,
  });

  test("keeps the silhouette she picked", () => {
    expect(withChosenBodyType(read, "Pear").bodyType).toBe("Pear");
  });

  test("keeps the rest of the read untouched", () => {
    const next = withChosenBodyType(read, "Pear");
    expect({ ...next, bodyType: read.bodyType }).toEqual(read);
  });

  test("uses the read's silhouette when she hasn't picked one", () => {
    expect(withChosenBodyType(read, "").bodyType).toBe("Hourglass");
  });
});
