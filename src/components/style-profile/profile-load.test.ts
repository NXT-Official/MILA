import { describe, expect, test } from "bun:test";
import { profileLoadOutcome } from "./profile-load";

describe("profileLoadOutcome: the editor opens only on her real profile", () => {
  test("the row arrived: loaded", () => {
    expect(profileLoadOutcome({ data: { id: "u1" }, error: null })).toBe("loaded");
  });

  test("an error (offline, 5xx, reconnecting) is a failed load, never a blank form", () => {
    expect(
      profileLoadOutcome({ data: null, error: { code: "MILA_SESSION_UNAVAILABLE", message: "" } }),
    ).toBe("failed");
    expect(profileLoadOutcome({ data: null, error: { code: "PGRST116", message: "" } })).toBe(
      "failed",
    );
  });

  test("no row and no error is still not her profile: failed, so the defaults can never be saved over it", () => {
    expect(profileLoadOutcome({ data: null, error: null })).toBe("failed");
  });
});
