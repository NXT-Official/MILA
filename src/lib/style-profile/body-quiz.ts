import type { BodyType } from "@/constants/style-profile/types";

/**
 * The two-question silhouette quiz (BodyTypeQuiz), as data: the questions'
 * answers and which silhouette each pair of answers points to. "Answer two
 * questions" is the no-camera way to set her silhouette, beside the body scan
 * and the tiles (Wave D plan, D-W5).
 *
 * "Fuller through the middle" was added so Apple can be reached; it comes
 * last, and every answer she could already give keeps its result.
 *
 * Pure and dependency-free: mobile copies this file verbatim (same path).
 */

export type Drape = "structured" | "waist" | "relaxed";
export type Balance = "aligned" | "hips" | "upper" | "middle";

export type QuizChoice<T extends string> = { value: T; label: string; hint: string };

export const DRAPE_CHOICES: readonly QuizChoice<Drape>[] = [
  {
    value: "structured",
    label: "Structured at the shoulders",
    hint: "The jacket holds its line up top.",
  },
  { value: "waist", label: "Form-fitting at the waist", hint: "It draws in just below the ribs." },
  { value: "relaxed", label: "Relaxed all over", hint: "It falls in a straight, easy line." },
];

export const BALANCE_CHOICES: readonly QuizChoice<Balance>[] = [
  { value: "aligned", label: "Shoulders and hips align", hint: "Mirrored top and bottom." },
  { value: "hips", label: "Curving at the hips", hint: "More softness through the lower half." },
  { value: "upper", label: "Stronger upper frame", hint: "Presence sits across the shoulders." },
  {
    value: "middle",
    label: "Fuller through the middle",
    hint: "Softness sits around the waist and tummy.",
  },
];

export const BODY_BY_ANSWER: Readonly<Record<Drape, Readonly<Record<Balance, BodyType>>>> = {
  structured: {
    aligned: "Inverted Triangle",
    upper: "Inverted Triangle",
    hips: "Hourglass",
    middle: "Apple",
  },
  waist: { aligned: "Hourglass", upper: "Hourglass", hips: "Pear", middle: "Apple" },
  relaxed: { aligned: "Rectangle", upper: "Rectangle", hips: "Pear", middle: "Apple" },
};

function isDrape(value: unknown): value is Drape {
  return DRAPE_CHOICES.some((choice) => choice.value === value);
}

function isBalance(value: unknown): value is Balance {
  return BALANCE_CHOICES.some((choice) => choice.value === value);
}

/** The silhouette her two answers point to; null until both are known answers. */
export function bodyTypeFromAnswers(
  drape: string | null | undefined,
  balance: string | null | undefined,
): BodyType | null {
  if (!isDrape(drape) || !isBalance(balance)) return null;
  return BODY_BY_ANSWER[drape][balance];
}

/** What she sees when her quiz result could not be saved. */
export const QUIZ_SAVE_ERROR = "That didn't save. Try again.";

/** One write of her own profile row, as the quiz sends it. */
export type QuizBodyTypeRow = { id: string; body_type: BodyType; updated_at: string };
export type QuizBodyTypeWrite = (row: QuizBodyTypeRow) => PromiseLike<{ error: unknown }>;

function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/**
 * Saves the quiz's silhouette on her own row and says whether it landed.
 * Never throws: a refused or failed write answers false, so the quiz can say
 * so instead of closing as if it saved. Only the error code is logged.
 */
export async function saveQuizBodyType(
  write: QuizBodyTypeWrite,
  userId: string,
  bodyType: BodyType,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  try {
    const { error } = await write({
      id: userId,
      body_type: bodyType,
      updated_at: now().toISOString(),
    });
    if (error) {
      console.error(JSON.stringify({ event: "body_quiz_save_error", code: errorCode(error) }));
      return false;
    }
    return true;
  } catch {
    console.error(JSON.stringify({ event: "body_quiz_save_error", code: "thrown" }));
    return false;
  }
}
