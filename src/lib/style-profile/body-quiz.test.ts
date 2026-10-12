import { describe, expect, test } from "bun:test";
import {
  BALANCE_CHOICES,
  BODY_BY_ANSWER,
  DRAPE_CHOICES,
  QUIZ_SAVE_ERROR,
  bodyTypeFromAnswers,
  saveQuizBodyType,
} from "./body-quiz";

/**
 * Golden vectors (Wave D plan, 3.7 parity rule): mobile copies body-quiz.ts
 * verbatim and copies these literal vectors into its own test.
 */
const EXISTING_ANSWERS: [drape: string, balance: string, body: string][] = [
  ["structured", "aligned", "Inverted Triangle"],
  ["structured", "upper", "Inverted Triangle"],
  ["structured", "hips", "Hourglass"],
  ["waist", "aligned", "Hourglass"],
  ["waist", "upper", "Hourglass"],
  ["waist", "hips", "Pear"],
  ["relaxed", "aligned", "Rectangle"],
  ["relaxed", "upper", "Rectangle"],
  ["relaxed", "hips", "Pear"],
];

const MIDDLE_ANSWERS: [drape: string, balance: string, body: string][] = [
  ["structured", "middle", "Apple"],
  ["waist", "middle", "Apple"],
  ["relaxed", "middle", "Apple"],
];

const EXISTING_CHOICES = {
  drape: [
    ["structured", "Structured at the shoulders", "The jacket holds its line up top."],
    ["waist", "Form-fitting at the waist", "It draws in just below the ribs."],
    ["relaxed", "Relaxed all over", "It falls in a straight, easy line."],
  ],
  balance: [
    ["aligned", "Shoulders and hips align", "Mirrored top and bottom."],
    ["hips", "Curving at the hips", "More softness through the lower half."],
    ["upper", "Stronger upper frame", "Presence sits across the shoulders."],
  ],
};

const ALL_BODIES = ["Hourglass", "Rectangle", "Pear", "Inverted Triangle", "Apple"];

describe("body quiz", () => {
  test("Fuller through the middle gives Apple for every drape", () => {
    const middle = BALANCE_CHOICES.find((c) => c.value === "middle");
    expect(middle).toEqual({
      value: "middle",
      label: "Fuller through the middle",
      hint: "Softness sits around the waist and tummy.",
    });
    for (const [drape, balance, body] of MIDDLE_ANSWERS) {
      expect(bodyTypeFromAnswers(drape, balance)).toBe(body);
    }
  });

  test("every body type is reachable", () => {
    const reached = new Set<string>();
    for (const drape of DRAPE_CHOICES) {
      for (const balance of BALANCE_CHOICES) {
        const body = bodyTypeFromAnswers(drape.value, balance.value);
        if (body) reached.add(body);
      }
    }
    expect([...reached].sort()).toEqual([...ALL_BODIES].sort());
  });

  test("the existing six answers keep their results", () => {
    // The six answers she could already give (three drapes, three balances)
    // keep their wording and their order...
    expect(DRAPE_CHOICES.map((c) => [c.value, c.label, c.hint])).toEqual(EXISTING_CHOICES.drape);
    expect(BALANCE_CHOICES.slice(0, 3).map((c) => [c.value, c.label, c.hint])).toEqual(
      EXISTING_CHOICES.balance,
    );
    // ...and every pair of them still gives the silhouette it gave before.
    for (const [drape, balance, body] of EXISTING_ANSWERS) {
      expect(bodyTypeFromAnswers(drape, balance)).toBe(body);
      expect(BODY_BY_ANSWER[drape as "waist"][balance as "hips"]).toBe(body);
    }
  });

  test("the new answer comes last, so the first three keep their places", () => {
    expect(BALANCE_CHOICES.map((c) => c.value)).toEqual(["aligned", "hips", "upper", "middle"]);
  });

  test("an unknown or missing answer gives no silhouette", () => {
    expect(bodyTypeFromAnswers(null, "hips")).toBeNull();
    expect(bodyTypeFromAnswers("waist", null)).toBeNull();
    expect(bodyTypeFromAnswers("waist", "elsewhere")).toBeNull();
    expect(bodyTypeFromAnswers("toString", "hips")).toBeNull();
    expect(bodyTypeFromAnswers("waist", "constructor")).toBeNull();
  });

  test("no choice label or hint has an em or en dash", () => {
    for (const c of [...DRAPE_CHOICES, ...BALANCE_CHOICES]) {
      expect(`${c.label} ${c.hint}`).not.toMatch(/[–—]/);
    }
    expect(QUIZ_SAVE_ERROR).not.toMatch(/[–—]/);
  });
});

describe("saveQuizBodyType", () => {
  const NOW = () => new Date("2026-10-07T09:00:00.000Z");

  test("sends her silhouette on her own row and answers true when it saved", async () => {
    const rows: unknown[] = [];
    const ok = await saveQuizBodyType(
      async (row) => {
        rows.push(row);
        return { error: null };
      },
      "user-1",
      "Apple",
      NOW,
    );
    expect(ok).toBe(true);
    expect(rows).toEqual([
      { id: "user-1", body_type: "Apple", updated_at: "2026-10-07T09:00:00.000Z" },
    ]);
  });

  test("answers false when the write is refused, and when it throws", async () => {
    const logged: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      expect(
        await saveQuizBodyType(
          async () => ({ error: { code: "42501", message: "denied" } }),
          "user-1",
          "Pear",
          NOW,
        ),
      ).toBe(false);
      expect(
        await saveQuizBodyType(
          async () => {
            throw new TypeError("Failed to fetch");
          },
          "user-1",
          "Pear",
          NOW,
        ),
      ).toBe(false);
    } finally {
      console.error = originalError;
    }
    // Only the code is logged, never her row.
    expect(JSON.stringify(logged)).not.toContain("user-1");
  });

  test("the failure line is the plan's copy", () => {
    expect(QUIZ_SAVE_ERROR).toBe("That didn't save. Try again.");
  });
});
