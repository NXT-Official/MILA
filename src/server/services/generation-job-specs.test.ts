import { describe, expect, test } from "bun:test";
import { GENERATION_DEADLINE_SECONDS } from "@/lib/generation-jobs.server";
import { RENDER_FUNCTION_BUDGET_MS } from "./render-budget";
import { COMPOSE_DEADLINE_MS, LOOK_FAILURE_MESSAGE, lookFromStored, lookJobInput } from "./look";
import {
  STYLE_SHEET_FAILED_REASON,
  STYLE_SHEET_UNVERIFIED_REASON,
  renderStyleSheetForUser,
  styleSheetJob,
} from "./style-sheet";
import {
  PHOTO_PREVIEW_FAILED_REASON,
  PHOTO_PREVIEW_UNVERIFIED_REASON,
  photoPreviewJob,
  renderPhotoPreviewForUser,
} from "./photo-preview";

const JPEG = "data:image/jpeg;base64,/9j/2Q==";

const LOOK = {
  outfit: { headline: "Linen day", description: "D", styling_notes: "S" },
  hair: { style: "Low bun", execution_tip: "Use a comb" },
  makeup: null,
  vibe_alignment_score: 8,
  shoppable_picks: [],
  forecastRetrievedAt: null,
  fallback_gender_direction: null,
};

describe("job deadlines", () => {
  // The wrapper fails a job at deadline minus its 15 s persist reserve; the
  // reaper refunds it 30 s after the deadline. Neither may cut off a render
  // or a compose that is still inside its own budget.
  const produceWindowMs = GENERATION_DEADLINE_SECONDS * 1000 - 15_000;

  test("covers the style sheet / portrait render budget", () => {
    expect(produceWindowMs).toBeGreaterThanOrEqual(RENDER_FUNCTION_BUDGET_MS);
  });

  test("covers the look's compose budget plus a minute for profile, weather and catalog", () => {
    expect(produceWindowMs).toBeGreaterThanOrEqual(COMPOSE_DEADLINE_MS + 60_000);
  });

  test("is never shorter than Vercel's 300 s function limit", () => {
    expect(GENERATION_DEADLINE_SECONDS).toBeGreaterThanOrEqual(300);
  });
});

describe("look job", () => {
  test("stores the request without the idempotency key or exact coordinates", () => {
    const input = lookJobInput({
      bodyType: "Hourglass",
      colorSeason: "Bright Winter",
      weather: "Sunny",
      vibe: "Work",
      location: "Lisbon",
      lat: 38.72,
      lon: -9.14,
      clientRequestId: "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f",
    });
    expect(input).toEqual({
      bodyType: "Hourglass",
      colorSeason: "Bright Winter",
      weather: "Sunny",
      vibe: "Work",
      location: "Lisbon",
    });
  });

  test("a stored look replays through the same schema", () => {
    expect(lookFromStored(LOOK as never).outfit.headline).toBe("Linen day");
  });

  test("a stored look that no longer validates answers the calm failure, not a crash", () => {
    expect(() => lookFromStored({ outfit: "nope" })).toThrow(LOOK_FAILURE_MESSAGE);
  });
});

describe.each([
  {
    name: "style sheet",
    job: styleSheetJob,
    mode: "style_sheet",
    unverified: STYLE_SHEET_UNVERIFIED_REASON,
    failed: STYLE_SHEET_FAILED_REASON,
  },
  {
    name: "portrait preview",
    job: photoPreviewJob,
    mode: "photo_edit",
    unverified: PHOTO_PREVIEW_UNVERIFIED_REASON,
    failed: PHOTO_PREVIEW_FAILED_REASON,
  },
] as const)("$name job", ({ job, mode, unverified, failed }) => {
  test("a render is stored as an image with only its mode in the result", () => {
    expect(job.settle({ imageDataUri: JPEG, mode } as never)).toEqual({
      ok: true,
      result: { mode },
      imageDataUri: JPEG,
    });
  });

  test("an unavailable answer is a refundable failure with a code per reason", () => {
    const unavailable = (reason: string) =>
      job.settle({ imageDataUri: null, mode: "unavailable", reason });
    expect(unavailable(unverified)).toEqual({ ok: false, errorCode: "qa_failed" });
    expect(unavailable(failed)).toEqual({ ok: false, errorCode: "render_failed" });
    expect(unavailable("The image service is busy right now.")).toEqual({
      ok: false,
      errorCode: "rate_limited",
    });
  });

  test("a replay answers today's shape from the stored image", () => {
    expect(job.fromStored({ imageDataUri: JPEG })).toEqual({ imageDataUri: JPEG, mode });
    expect(job.fromStored({ imageDataUri: null })).toEqual({
      imageDataUri: null,
      mode: "unavailable",
      reason: failed,
    });
  });

  test("a failed job answers the same calm copy as a live failure", () => {
    expect(job.failure("qa_failed")).toEqual({
      imageDataUri: null,
      mode: "unavailable",
      reason: unverified,
    });
    for (const code of ["render_failed", "deadline_exceeded", "persist_failed", "unknown"]) {
      expect(job.failure(code)).toEqual({
        imageDataUri: null,
        mode: "unavailable",
        reason: failed,
      });
    }
  });

  test("no copy carries an em or en dash", () => {
    expect(`${unverified} ${failed}`).not.toMatch(/[—–]/);
  });
});

describe("consent gate comes before the job", () => {
  // A member client whose profile has no consented photo. Nothing here can
  // reach the service-role store: if a job (or a charge) were attempted
  // first, the call would fail instead of answering.
  const noConsent = {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: { gender: null, photo_consent_at: null, profile_photo_path: null },
          error: null,
        }),
      };
      return chain;
    },
  } as never;

  test("style sheet: no consented photo answers without a job or a charge", async () => {
    expect(await renderStyleSheetForUser(noConsent, "user-1", { outfit: LOOK as never })).toEqual({
      imageDataUri: null,
      mode: "unavailable",
      reason: "No consented photo on file.",
    });
  });

  test("portrait preview: no consented photo answers without a job or a charge", async () => {
    expect(await renderPhotoPreviewForUser(noConsent, "user-1", { outfit: LOOK as never })).toEqual(
      {
        imageDataUri: null,
        mode: "unavailable",
        reason: "No consented photo on file.",
      },
    );
  });
});
