import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MILA_VOICE } from "./mila-voice";

const read = (p: string) => readFileSync(join(import.meta.dir, p), "utf8");

describe("MILA_VOICE", () => {
  test("names the words and openers that read as AI", () => {
    for (const tell of ["elevate", "effortless", "curated", "unlock", "delve", "Great question"]) {
      expect(MILA_VOICE).toContain(tell);
    }
  });

  test("every member-facing generation prompt interpolates the voice block", () => {
    expect(read("../server/services/concierge.ts")).toContain("${MILA_VOICE}");
    expect(read("./generate-outfit.functions.ts")).toContain("${MILA_VOICE}");
    expect(read("../server/services/outfit-analysis.ts")).toContain("${MILA_VOICE}");
  });
});
