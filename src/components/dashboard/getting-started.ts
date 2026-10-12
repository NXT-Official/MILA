/**
 * "I don't understand what I'm supposed to do in the app" — answered in three
 * lines, at the top of the dashboard.
 *
 * The dashboard used to open on statistics: credits, a completion percentage,
 * looks this month. Those describe a member who already knows the routine. A
 * new one sees numbers and no instructions. This checklist names the three
 * moves that actually matter, in the order they happen — finish the seven
 * questions, add a selfie, compose a look — and points at each one.
 *
 * Two rules keep it from becoming the nagging it replaces:
 *
 *  1. Only the core answers count. The profile step is done at 100% of the
 *     nine profile fields, and every one of those is asked in the seven core
 *     questions — never the optional extras, so nobody is pushed at
 *     measurements to clear a checklist item.
 *  2. It removes itself. All three done, or dismissed once, and the card is
 *     gone for good (see `readGettingStartedDismissed`).
 */

/** The `localStorage` key that remembers a dismissal. */
export const GETTING_STARTED_DISMISS_KEY = "mila.getting-started.dismissed";

export interface GettingStartedInput {
  /** `styleProfileCompletionPercent` for the member's row: 0–100. */
  profileCompletionPercent: number;
  /** `profiles.photo_consent_at` is set — a selfie was uploaded and consented to. */
  hasPhotoConsent: boolean;
  /** At least one look exists for the member. */
  hasComposedLook: boolean;
}

export interface GettingStartedStep {
  id: "profile" | "photo" | "look";
  title: string;
  hint: string;
  cta: string;
  /** In-page anchor or app route for the CTA. */
  href: string;
  done: boolean;
}

export interface GettingStartedProgress {
  done: number;
  total: number;
  /** 0–100, rounded. An empty checklist counts as complete, never as 0%. */
  percent: number;
  allDone: boolean;
}

/** The three moves, in the order they happen. */
export function gettingStartedSteps(input: GettingStartedInput): GettingStartedStep[] {
  return [
    {
      id: "profile",
      title: "Finish your style profile",
      hint: "The seven questions are all Mila needs. Everything after them is optional.",
      cta: "Open style profile",
      href: "/style-profile",
      done: input.profileCompletionPercent >= 100,
    },
    {
      id: "photo",
      title: "Add a selfie",
      hint: "One clear photo lets Mila read your colouring and try a look on you.",
      cta: "Go to the photo card",
      href: "#selfie-photo",
      done: input.hasPhotoConsent,
    },
    {
      id: "look",
      title: "Compose today's look",
      hint: "Pick a vibe and press Generate — Mila writes the outfit for the weather.",
      cta: "Go to the generator",
      href: "#hero-generate",
      done: input.hasComposedLook,
    },
  ];
}

export function gettingStartedProgress(steps: GettingStartedStep[]): GettingStartedProgress {
  const total = steps.length;
  const done = steps.filter((step) => step.done).length;
  return {
    done,
    total,
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
    allDone: total > 0 && done === total,
  };
}

/** The one step worth calling out first, or null when the list is finished. */
export function nextGettingStartedStep(steps: GettingStartedStep[]): GettingStartedStep | null {
  return steps.find((step) => !step.done) ?? null;
}

/**
 * A dismissal is remembered per browser. Storage can throw (Safari private
 * mode, a hardened browser) and a checklist is not worth a blank dashboard, so
 * every access is guarded and a failure reads as "not dismissed".
 */
export function readGettingStartedDismissed(
  storage: Pick<Storage, "getItem"> | null | undefined = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(GETTING_STARTED_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeGettingStartedDismissed(
  storage: Pick<Storage, "setItem"> | null | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(GETTING_STARTED_DISMISS_KEY, "1");
  } catch {
    // Nothing to do: the card simply comes back on the next visit.
  }
}

function defaultStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
