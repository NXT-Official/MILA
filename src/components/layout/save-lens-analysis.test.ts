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
