import { describe, expect, test } from "bun:test";
import {
  GETTING_STARTED_DISMISS_KEY,
  gettingStartedProgress,
  gettingStartedSteps,
  nextGettingStartedStep,
  readGettingStartedDismissed,
  writeGettingStartedDismissed,
} from "./getting-started";

const FRESH = {
  profileCompletionPercent: 0,
  hasPhotoConsent: false,
  hasComposedLook: false,
};

const DONE = {
  profileCompletionPercent: 100,
  hasPhotoConsent: true,
  hasComposedLook: true,
};

describe("getting started checklist", () => {
  test("a new member is told the three moves, in the order they happen", () => {
    const steps = gettingStartedSteps(FRESH);
    expect(steps.map((step) => step.id)).toEqual(["profile", "photo", "look"]);
    expect(steps.every((step) => step.done)).toBe(false);
  });

  test("every step carries the copy that makes it actionable", () => {
    for (const step of gettingStartedSteps(FRESH)) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.hint.length).toBeGreaterThan(0);
      expect(step.cta.length).toBeGreaterThan(0);
      expect(step.href.startsWith("/") || step.href.startsWith("#")).toBe(true);
    }
  });

  test("the profile step is done at exactly 100%, not at 99%", () => {
    const at99 = gettingStartedSteps({ ...FRESH, profileCompletionPercent: 99 });
    expect(at99.find((step) => step.id === "profile")?.done).toBe(false);
    const at100 = gettingStartedSteps({ ...FRESH, profileCompletionPercent: 100 });
    expect(at100.find((step) => step.id === "profile")?.done).toBe(true);
  });

  test("the profile step never asks for the optional extras", () => {
    // The nine checked fields are all answered inside the seven core questions,
    // so a member who stopped at the fork still clears the step.
    const steps = gettingStartedSteps({ ...FRESH, profileCompletionPercent: 100 });
    const hint = steps.find((step) => step.id === "profile")?.hint ?? "";
    expect(hint).toContain("seven questions");
    expect(hint.toLowerCase()).toContain("optional");
  });

  test("the photo and look steps key on their own signals", () => {
    const photoOnly = gettingStartedSteps({ ...FRESH, hasPhotoConsent: true });
    expect(photoOnly.find((step) => step.id === "photo")?.done).toBe(true);
    expect(photoOnly.find((step) => step.id === "look")?.done).toBe(false);

    const lookOnly = gettingStartedSteps({ ...FRESH, hasComposedLook: true });
    expect(lookOnly.find((step) => step.id === "look")?.done).toBe(true);
    expect(lookOnly.find((step) => step.id === "photo")?.done).toBe(false);
  });

  test("progress counts the finished steps and hides the card once all are done", () => {
    const empty = gettingStartedProgress(gettingStartedSteps(FRESH));
    expect(empty).toEqual({ done: 0, total: 3, percent: 0, allDone: false });

    const partial = gettingStartedProgress(
      gettingStartedSteps({ ...FRESH, profileCompletionPercent: 100 }),
    );
    expect(partial).toEqual({ done: 1, total: 3, percent: 33, allDone: false });

    const complete = gettingStartedProgress(gettingStartedSteps(DONE));
    expect(complete).toEqual({ done: 3, total: 3, percent: 100, allDone: true });
  });

  test("an empty checklist reads as complete, never as 0%", () => {
    expect(gettingStartedProgress([])).toEqual({
      done: 0,
      total: 0,
      percent: 100,
      allDone: false,
    });
  });

  test("the next step is the first unfinished one, and null when finished", () => {
    expect(nextGettingStartedStep(gettingStartedSteps(FRESH))?.id).toBe("profile");
    expect(
      nextGettingStartedStep(gettingStartedSteps({ ...FRESH, profileCompletionPercent: 100 }))?.id,
    ).toBe("photo");
    expect(nextGettingStartedStep(gettingStartedSteps(DONE))).toBeNull();
  });

  test("a dismissal survives a reload and reads as one", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };

    expect(readGettingStartedDismissed(storage)).toBe(false);
    writeGettingStartedDismissed(storage);
    expect(store.get(GETTING_STARTED_DISMISS_KEY)).toBe("1");
    expect(readGettingStartedDismissed(storage)).toBe(true);
  });

  test("storage that throws never breaks the dashboard", () => {
    const angry = {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
    };

    expect(readGettingStartedDismissed(angry)).toBe(false);
    expect(() => writeGettingStartedDismissed(angry)).not.toThrow();
  });

  test("no storage at all (server render) reads as not dismissed", () => {
    expect(readGettingStartedDismissed(null)).toBe(false);
    expect(() => writeGettingStartedDismissed(null)).not.toThrow();
  });
});
