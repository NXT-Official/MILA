import { describe, expect, spyOn, test } from "bun:test";
import {
  GenerationDeliveredUnsavedError,
  GenerationInFlightError,
} from "@/lib/generation-jobs.server";
import { respondWithError } from "./respond";

describe("respondWithError: generation jobs", () => {
  test("a delivered-but-unsaved replay is 409 DELIVERED_NOT_SAVED with its calm copy, never INTERNAL", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = respondWithError(
        "analysis/dupes",
        new GenerationDeliveredUnsavedError("job-1"),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: {
          code: "DELIVERED_NOT_SAVED",
          message:
            "This result was made, but it couldn't be saved, so it can't be shown again. You won't be charged again for it.",
        },
      });
      // Classified, so it is neither logged nor reported as unhandled.
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  test("a job still in flight stays 429 RATE_LIMITED with retryAfter (unchanged)", async () => {
    const response = respondWithError("look/generate", new GenerationInFlightError(30));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Mila is still finishing your last request. Try again in a moment.",
        retryAfter: 30,
      },
    });
  });
});
