import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { saveLensAnalysis } from "./save-lens-analysis";

const ROW = {
  user_id: "user-1",
  image_url: "https://example.com/outfits/user-1/look.jpg",
  analysis_result: {
    color_match: "Warm",
    silhouette: "Balanced",
    overall_score: 82,
    verdict: "Lovely",
  },
  match_score: 82,
};

/** A client whose insert resolves to `result`, recording the table and row it was given. */
function fakeDb(result: { data: { id: string } | null; error: { message: string } | null }) {
  const insert = mock((_row: unknown) => ({
    select: (_columns: string) => ({ single: async () => result }),
  }));
  const from = mock((_table: string) => ({ insert }));
  return { db: { from } as unknown as Parameters<typeof saveLensAnalysis>[0], from, insert };
}

describe("saveLensAnalysis", () => {
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test("a written row comes back as the saved look's id", async () => {
    const { db, from, insert } = fakeDb({ data: { id: "look-9" }, error: null });

    expect(await saveLensAnalysis(db, ROW)).toEqual({ id: "look-9" });
    expect(from).toHaveBeenCalledWith("outfits");
    expect(insert).toHaveBeenCalledWith(ROW);
  });

  test("a rejected insert is not reported as saved", async () => {
    // The score column is bounded and the row is RLS-owned, so the write can be
    // refused; the member must not be told it landed in their history.
    const { db } = fakeDb({
      data: null,
      error: { message: 'violates check constraint "outfits_match_score_range"' },
    });

    expect(await saveLensAnalysis(db, ROW)).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  test("no row coming back is not a save either", async () => {
    const { db } = fakeDb({ data: null, error: null });

    expect(await saveLensAnalysis(db, ROW)).toBeNull();
  });
});

// `outfits.match_score` is an INTEGER with a 0-100 CHECK, and the credit for the
// read is already spent by the time the row is written, so a score the model
// reports as 82.6, 140 or "n/a" must be made safe before the insert, not refused by it.
describe("saveLensAnalysis score", () => {
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  async function scoreWritten(matchScore: unknown): Promise<unknown> {
    const { db, insert } = fakeDb({ data: { id: "look-1" }, error: null });
    await saveLensAnalysis(db, { ...ROW, match_score: matchScore as number });
    const written = insert.mock.calls[0]?.[0] as { match_score: unknown };
    return written.match_score;
  }

  test.each([
    [82.6, 83],
    [82.4, 82],
    [100.4, 100],
    [0, 0],
    [100, 100],
  ])("a score of %p is stored as the integer %p", async (given, stored) => {
    expect(await scoreWritten(given)).toBe(stored);
  });

  test.each([
    [140, 100],
    [-8, 0],
    [Infinity, 100],
    [-Infinity, 0],
  ])("a score of %p is held inside 0-100 as %p", async (given, stored) => {
    expect(await scoreWritten(given)).toBe(stored);
  });

  test("a numeric string is read as its number", async () => {
    expect(await scoreWritten("77")).toBe(77);
  });

  test.each([[Number.NaN], [null], [undefined], ["n/a"], [""], [{}]])(
    "a score of %p that is no number at all is stored as no score",
    async (given) => {
      expect(await scoreWritten(given)).toBeNull();
    },
  );

  test("the rest of the row is written untouched", async () => {
    const { db, insert } = fakeDb({ data: { id: "look-1" }, error: null });

    await saveLensAnalysis(db, { ...ROW, match_score: 91.7 });

    expect(insert).toHaveBeenCalledWith({ ...ROW, match_score: 92 });
  });
});
