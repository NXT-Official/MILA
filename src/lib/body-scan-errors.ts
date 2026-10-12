import { INSUFFICIENT_CREDITS } from "@/lib/credits";
import { errorMessage, isStaleBundleError } from "@/lib/utils";

/**
 * What she reads when a body scan does not give her a suggestion (Wave D
 * plan, 3.4). The server answers `{ success: false, error: <code> }`; only
 * "another scan is still being read" is thrown.
 *
 * The codes are copied from src/server/services/body-scan.ts (a test keeps
 * them equal): that module runs on the server only and must never be pulled
 * into the browser bundle.
 */
export const BODY_SCAN_CODES = {
  NOT_FULL_LENGTH: "BODY_SCAN_NOT_FULL_LENGTH",
  RATE_LIMITED: "BODY_SCAN_RATE_LIMITED",
  PHOTO_TOO_LARGE: "BODY_SCAN_PHOTO_TOO_LARGE",
  UNAVAILABLE: "BODY_SCAN_UNAVAILABLE",
  FAILED: "BODY_SCAN_FAILED",
} as const;

/** Client-side code for the thrown "still finishing your last request" answer. */
export const BODY_SCAN_STILL_FINISHING = "BODY_SCAN_STILL_FINISHING";

/** The server refuses a photo whose base64 is longer than this (risk K2). */
export const BODY_SCAN_MAX_PHOTO_CHARS = 1_800_000;

export type BodyScanFailure = {
  /** A warm, plain line. Never a code. Empty when nothing is shown. */
  message: string;
  /** Out of credits: open the memberships dialog, never a toast. */
  outOfCredits: boolean;
  /** The Wave D migration is missing: hide "Scan my shape", say nothing. */
  unavailable: boolean;
  /** The photo did not show her whole body: offer the two questions too. */
  offerQuiz: boolean;
};

const failure = (message: string, extra: Partial<BodyScanFailure> = {}): BodyScanFailure => ({
  message,
  outOfCredits: false,
  unavailable: false,
  offerQuiz: false,
  ...extra,
});

const GENERIC = failure(
  "Mila couldn't read that photo. Any credit it used has been returned. Please try again.",
);

export function describeBodyScanError(code: string | null | undefined): BodyScanFailure {
  switch (code) {
    case BODY_SCAN_CODES.NOT_FULL_LENGTH:
      return failure(
        "I couldn't see your whole body. Try again from further back, or answer two questions instead.",
        { offerQuiz: true },
      );
    case BODY_SCAN_CODES.RATE_LIMITED:
      return failure("That's a lot of scans in a short while. Please try again later.");
    case BODY_SCAN_CODES.PHOTO_TOO_LARGE:
      return failure("That photo is too large. Try another one.");
    case BODY_SCAN_STILL_FINISHING:
      return failure("Mila is still finishing your last scan. Try again in a moment.");
    case BODY_SCAN_CODES.UNAVAILABLE:
      return failure("", { unavailable: true });
    case INSUFFICIENT_CREDITS:
      return failure("You've used today's styling credits.", { outOfCredits: true });
    default:
      return GENERIC;
  }
}

const STILL_FINISHING = /still finishing your last request/i;

/**
 * The server's "still finishing your last request" answer (another scan of a
 * different photo is still being read). Found by shape first (the error's
 * name, or a 429 that is not the plain hourly limit), with the text as a
 * fallback for a wire that drops the fields.
 */
export function isBodyScanInFlight(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "GenerationInFlightError") return true;
  if (
    (error as { statusCode?: unknown }).statusCode === 429 &&
    error.name !== "RateLimitExceededError"
  ) {
    return true;
  }
  return STILL_FINISHING.test(error.message);
}

const LOST_CONNECTION =
  /failed to fetch|networkerror|network request failed|load failed|network connection was lost/i;

/**
 * No answer came back (a client timeout, a dropped connection, a stale
 * bundle): the scan may still be running or may have finished. The press
 * keeps its request id, so "Try again" replays it instead of paying twice.
 */
export function isLostBodyScanAnswer(error: unknown): boolean {
  if (error instanceof Error && error.name === "TimeoutError") return true;
  if (isStaleBundleError(error)) return true;
  return LOST_CONNECTION.test(errorMessage(error, ""));
}
