import { createHash } from "node:crypto";
import { z } from "zod";
import type { AiResult } from "@/lib/ai.server";
import {
  BODIES,
  HAIR_COLORS,
  HAIR_LENGTHS,
  SKIN_DEPTHS,
  type BodyType,
  type HairColor,
} from "@/constants/style-profile";

/**
 * What Today's check-in and the body scan share (Wave D plan, D-W3): the two
 * strict tools, their prompts, the photo digest a job's input carries instead
 * of the photo, the per-photo size cap, and the ledger that decides whether a
 * request may hand its hourly slot back.
 *
 * Photos are read in memory only (R-4): they go to the model as data URIs and
 * nowhere else. Nothing here logs, stores or returns them.
 */

export type SkinDepth = (typeof SKIN_DEPTHS)[number];
export type HairLength = (typeof HAIR_LENGTHS)[number];

/** The model's answer when there is no usable full-length photo. Never stored. */
export const NOT_VISIBLE = "not_visible";
export const SILHOUETTE_VALUES = [...BODIES, NOT_VISIBLE] as const;
type Silhouette = (typeof SILHOUETTE_VALUES)[number];

/** Each photo's base64 is at most this many characters (risk K2): two photos
 * and the JSON around them stay under Vercel's 4.5 MB request body limit. */
export const MAX_PHOTO_CHARS = 1_800_000;
/** The input schemas' own ceiling. Anything between the two is answered with
 * the member-facing "too large" code instead of a validation error. */
export const MAX_PHOTO_TRANSPORT_CHARS = 15_000_000;
export const PHOTO_TOO_LARGE_COPY = "That photo is too large. Try another one.";
/** The gateway's own per-call ceiling (TIMEOUT_MS in ai.server). */
export const READ_TIMEOUT_MS = 110_000;

/** What Today's check-in reads (the `read` of a successful answer). */
export type CheckInRead = {
  skinDepth: SkinDepth;
  hairColor: HairColor;
  hairLength: HairLength;
  /** Null when there is no usable full-length photo. */
  silhouette: BodyType | null;
  /** Null when no body photo was sent. */
  bodyPhotoUsable: boolean | null;
};

const asList = (values: readonly string[]) => [...values];

const SILHOUETTE_PROPERTY = {
  type: "string",
  enum: asList(SILHOUETTE_VALUES),
  description:
    "Her body shape, read from the full-length photo only. not_visible when there is no full-length photo, or it does not show her whole body.",
};

const BODY_FULL_LENGTH_PROPERTY = {
  type: "boolean",
  description: "True only when the full-length photo shows her whole body, head to feet.",
};

export const CHECK_IN_TOOL = {
  function: {
    name: "report_check_in",
    parameters: {
      type: "object",
      properties: {
        skinDepth: {
          type: "string",
          enum: asList(SKIN_DEPTHS),
          description: "How light or deep her skin is once you allow for the room's light.",
        },
        hairColor: {
          type: "string",
          enum: asList(HAIR_COLORS),
          description: "Her hair as it is today, dyed or natural.",
        },
        hairLength: {
          type: "string",
          enum: asList(HAIR_LENGTHS),
          description:
            "Short: above the chin. Medium: chin to shoulders. Long: below the shoulders. Bald/Shaved: no hair to speak of.",
        },
        silhouette: SILHOUETTE_PROPERTY,
        faceVisible: {
          type: "boolean",
          description: "True only when her face is clear enough to read her skin and hair.",
        },
        bodyFullLength: BODY_FULL_LENGTH_PROPERTY,
      },
      required: [
        "skinDepth",
        "hairColor",
        "hairLength",
        "silhouette",
        "faceVisible",
        "bodyFullLength",
      ],
      additionalProperties: false,
    },
  },
};

export const BODY_SCAN_TOOL = {
  function: {
    name: "report_body_scan",
    parameters: {
      type: "object",
      properties: {
        silhouette: SILHOUETTE_PROPERTY,
        bodyFullLength: BODY_FULL_LENGTH_PROPERTY,
      },
      required: ["silhouette", "bodyFullLength"],
      additionalProperties: false,
    },
  },
};

const REFUSAL =
  "Never judge or mention season, undertone, gender, age, height, weight or attractiveness.";

const SILHOUETTE_LINE = `- silhouette: her body shape, from the full-length photo only. One of ${BODIES.join(", ")}. Answer ${NOT_VISIBLE} when there is no full-length photo or it does not show her whole body.`;

export const CHECK_IN_SYSTEM_PROMPT = [
  "You read everyday photos for a personal stylist. Report only what report_check_in asks.",
  `- skinDepth: how light or deep her skin is once you allow for the room's light. One of ${SKIN_DEPTHS.join(", ")}.`,
  `- hairColor: her hair as it is today, dyed or natural. One of ${HAIR_COLORS.join(", ")}.`,
  "- hairLength: Short is above the chin. Medium is chin to shoulders. Long is below the shoulders. Bald/Shaved when there is no hair to speak of.",
  SILHOUETTE_LINE,
  "- faceVisible: true only when her face is clear enough to read her skin and hair.",
  "- bodyFullLength: true only when Photo 2 shows her whole body, head to feet. False when there is no Photo 2.",
  REFUSAL,
  "Answer only by calling the report_check_in tool.",
].join("\n");

export const CHECK_IN_USER_TEXT =
  "Photo 1 is her face. Photo 2, when present, is a full-length photo.";

export const BODY_SCAN_SYSTEM_PROMPT = [
  "You read everyday photos for a personal stylist. Report only what report_body_scan asks.",
  SILHOUETTE_LINE,
  "- bodyFullLength: true only when the photo shows her whole body, head to feet.",
  REFUSAL,
  "Answer only by calling the report_body_scan tool.",
].join("\n");

export const BODY_SCAN_USER_TEXT = "This is her full-length photo.";

/**
 * The first 16 hex characters of the SHA-256 of the photos' base64, in order
 * (joined by a newline, which base64 never contains). This is all a job's
 * input keeps of a photo: enough to tell a double press of the same photos
 * from a new pair while one is still being read, never the photo.
 */
export function photoDigest(base64s: readonly string[]): string {
  return createHash("sha256").update(base64s.join("\n")).digest("hex").slice(0, 16);
}

export function isPhotoTooLarge(base64: string | null | undefined): boolean {
  return typeof base64 === "string" && base64.length > MAX_PHOTO_CHARS;
}

/** One photo as a vision message part (same base64 contract as the colour read). */
export function photoPart(base64: string) {
  return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } };
}

// Structured output is requested, but not every provider behind a model
// enforces it: case and spacing variants ("dark brown", "Not visible") map to
// the stored value; anything that maps to nothing is refused.
const canonical = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function modelEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((raw) => {
    if (typeof raw !== "string") return raw;
    const key = canonical(raw);
    return values.find((value) => canonical(value) === key) ?? raw;
  }, z.enum(values));
}

const modelBoolean = z.preprocess((raw) => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}, z.boolean());

// Strict, like the tools (`additionalProperties: false`): a reply carrying a
// key the tool never asked for (a season, a weight) is refused, not trimmed.
export const CheckInReplySchema = z
  .object({
    skinDepth: modelEnum(SKIN_DEPTHS),
    hairColor: modelEnum(HAIR_COLORS),
    hairLength: modelEnum(HAIR_LENGTHS),
    silhouette: modelEnum(SILHOUETTE_VALUES),
    faceVisible: modelBoolean,
    bodyFullLength: modelBoolean,
  })
  .strict();

export const BodyScanReplySchema = z
  .object({
    silhouette: modelEnum(SILHOUETTE_VALUES),
    bodyFullLength: modelBoolean,
  })
  .strict();

/** A silhouette she can be offered: a body type, read from a whole-body photo. */
export function usableSilhouette(silhouette: Silhouette, bodyFullLength: boolean): BodyType | null {
  return bodyFullLength && silhouette !== NOT_VISIBLE ? silhouette : null;
}

/** Stored results are re-checked before a replay hands them back. The read
 * is the object Mila wrote, so it is strict; the job envelope around it is
 * not (the job layer may annotate a result). */
export const CheckInReadSchema = z
  .object({
    skinDepth: z.enum(SKIN_DEPTHS),
    hairColor: z.enum(HAIR_COLORS),
    hairLength: z.enum(HAIR_LENGTHS),
    silhouette: z.enum(BODIES).nullable(),
    bodyPhotoUsable: z.boolean().nullable(),
  })
  .strict();

export const StoredBodyScanSchema = z.object({ silhouette: z.enum(BODIES) });

/**
 * Provider refusals she cannot cause (fix round 1, M-2; the rule D-W1 adopts
 * for the colour read): our key (401), our provider balance (402), the model
 * (404), the provider's rate limit (429), its outage (500, 503). Only these
 * hand the hourly slot back. A refusal she can cause with a bad photo (400,
 * 403, 413, 422), a reply (even an unusable one), 502, 504 and anything else
 * keep it, so garbage photos can never buy unlimited provider round trips.
 */
export const RELEASABLE_PROVIDER_REFUSALS: ReadonlySet<number> = new Set([
  401, 402, 404, 429, 500, 503,
]);

/**
 * R-2, as amended by the coordinator (2026-10-07) and narrowed in fix round 1
 * (M-2): a request hands its hourly slot back only when it made no provider
 * call, or every call it made was a refusal she cannot cause
 * (RELEASABLE_PROVIDER_REFUSALS). A reply, even one judged unusable ("photo
 * unusable", "not full length"), keeps the slot; its credit is still refunded
 * by the job rules. A call that threw, or is still running when the request
 * answers (past its deadline), keeps it too: when unsure, the slot stays
 * spent.
 *
 * One ledger per request, and each request consumed exactly one slot, so a
 * release is at most once per consume: a replay or an attached request made
 * no call and hands back its own slot, never the slot of the request that
 * produced the job.
 */
export function createProviderCallLedger() {
  let keepsSlot = false;
  let pending = 0;
  return {
    async call(run: () => Promise<AiResult>): Promise<AiResult> {
      pending += 1;
      try {
        const result = await run();
        if (result.ok || !RELEASABLE_PROVIDER_REFUSALS.has(result.status)) keepsSlot = true;
        return result;
      } catch (err) {
        keepsSlot = true;
        throw err;
      } finally {
        pending -= 1;
      }
    },
    /** True while every call by this request (if any) was a refusal she cannot cause. */
    mayRelease: () => !keepsSlot && pending === 0,
  };
}

export type ProviderCallLedger = ReturnType<typeof createProviderCallLedger>;
