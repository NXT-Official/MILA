import { INSUFFICIENT_CREDITS } from "@/lib/credits";

export type ColorReadFailure = {
  /** A warm, plain line a member can read. Never the server's code. */
  message: string;
  /** The member is out of credits — open the upgrade dialog, not just a toast. */
  outOfCredits: boolean;
};

const TAKING_LONGER: ColorReadFailure = {
  message: "Mila is taking longer than usual. Please try again in a moment.",
  outOfCredits: false,
};

const RATE_LIMITED: ColorReadFailure = {
  message: "That's too many reads in a short while. Please try again later.",
  outOfCredits: false,
};

const COULD_NOT_READ_PHOTO: ColorReadFailure = {
  message: "I couldn't read that photo. Try soft, even light, or a different photo.",
  outOfCredits: false,
};

const OUT_OF_CREDITS: ColorReadFailure = {
  message: "You've used today's styling credits.",
  outOfCredits: true,
};

const GENERIC: ColorReadFailure = {
  message: "Mila couldn't finish this read. Please try again in a little while.",
  outOfCredits: false,
};

/**
 * The client stopped waiting (COLOR_READ_CLIENT_TIMEOUT_MS) while the read may
 * still be running as her job. Never a failure: her result waits in the job
 * row (Wave D plan, section 3.4).
 */
export const COLOR_READ_TIMEOUT = "COLOR_READ_TIMEOUT";

/** The tab runs a bundle from before a deploy: the call never reached the read. */
export const COLOR_READ_STALE_BUNDLE = "COLOR_READ_STALE_BUNDLE";

const STILL_READING: ColorReadFailure = {
  message:
    "Mila is still reading your photo. You can close this; your result will wait for you here.",
  outOfCredits: false,
};

const STALE_BUNDLE: ColorReadFailure = {
  message: "Mila was updated while this page was open. Refresh the page and try again.",
  outOfCredits: false,
};

/**
 * Turns whatever `analyzePersonalColor` returned in `error` into copy for the
 * member. The server answers with codes (`SERVER_GATEWAY_TIMEOUT`,
 * `ANALYSIS_PARSING_FAILED`, ...) and, for the member's own credits, the
 * `INSUFFICIENT_CREDITS` sentence. Anything unrecognised, and the failures a
 * member can do nothing about (a missing server key, the provider's own
 * credits running out), gets the generic line, so no code ever reaches the
 * screen.
 */
export function describeColorReadError(code: string | null | undefined): ColorReadFailure {
  switch (code) {
    case "SERVER_GATEWAY_TIMEOUT":
    case "ANALYSIS_GATEWAY_FAILURE":
      return TAKING_LONGER;
    case "ANALYSIS_RATE_LIMITED":
      return RATE_LIMITED;
    case "ANALYSIS_PARSING_FAILED":
      return COULD_NOT_READ_PHOTO;
    case INSUFFICIENT_CREDITS:
      return OUT_OF_CREDITS;
    case COLOR_READ_TIMEOUT:
      return STILL_READING;
    case COLOR_READ_STALE_BUNDLE:
      return STALE_BUNDLE;
    default:
      return GENERIC;
  }
}
