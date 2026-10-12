import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { aiChatCompletion, isAiConfigured, type AiResult } from "@/lib/ai.server";
import {
  consumeRateLimit,
  releaseRateLimit,
  RateLimitExceededError,
  type RateLimitResult,
} from "@/lib/rate-limit.server";
import { withAiCredit } from "@/lib/credits.server";
import { INSUFFICIENT_CREDITS, isInsufficientCreditsError } from "@/lib/credits";
import {
  GENERATION_DEADLINE_SECONDS,
  GenerationDeliveredUnsavedError,
  GenerationInFlightError,
  resolveDailyAllowance,
  withGenerationJob,
  withJobId,
  type GenerationJobContext,
  type GenerationJobOutcome,
  type GenerationJobSpec,
  type GenerationWriteGuard,
  type LegacyGenerationContext,
} from "@/lib/generation-jobs.server";
import {
  HAIR_COLORS,
  SEASON_HEX_MATRIX,
  SEASON_KEYS,
  SEASONS_MASTER_DATA,
  SKIN_DEPTHS,
  type SeasonKey,
} from "@/constants/style-profile";

type MilaSupabaseClient = SupabaseClient<Database>;

/**
 * The personal-colour studio read, shared verbatim by the web
 * `analyzePersonalColor` server function and the mobile
 * `POST /api/v1/analysis/personal-color` route.
 *
 * The founding read — the once-ever free read, tracked in
 * `profiles.founding_color_read_at` (service-role write only) — is free;
 * re-reads cost **1 AI credit**, 10/hour either way.
 *
 * Wave D (D-W1):
 * - Pass 2's one call also reads her hair colour and skin depth; there is no
 *   extra AI call. A value off the list is dropped, never guessed, and hair
 *   that cannot be seen comes back as null.
 * - The read runs as a `color_read` generation job: a re-read is charged once
 *   per `clientRequestId` (a double press or a reload replays it), the founding
 *   read is a free job, and a failed job refunds its credit. Until the
 *   generation_jobs migration is applied, today's path runs unchanged.
 * - The founding read is claimed atomically before the AI call, so two racing
 *   reads are never both free; the claim goes back when she gets no read.
 * - The hourly slot comes back only when every provider call this request
 *   made was a refusal she cannot cause (plan R-2 as amended, D-W1 review
 *   I-1), at most once, and never to a request answered from another
 *   request's job.
 */

const SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;
const TONE_TYPES = ["Warm Tone (Yellow Base)", "Cool Tone (Blue Base)"] as const;
const BRIGHTNESS = ["High Lightness", "Medium Lightness", "Low Lightness"] as const;
const SATURATIONS = ["Low-Mid Saturation", "High Saturation"] as const;
const CONTRAST_SCALES = ["Low Contrast", "Medium Contrast", "High Contrast"] as const;
const FACE_SHAPES = [
  "Diamond Geometry",
  "Oval Frame",
  "Round Frame",
  "Square Frame",
  "Heart Frame",
  "Long Frame",
] as const;
const BODY_TYPES = ["Inverted Triangle", "Hourglass", "Pear", "Rectangle", "Apple"] as const;

const SwatchSchema = z.object({
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Expected a 6-digit hex color"),
  name: z.string().min(1),
});

const StudioColorProfileSchema = z.object({
  season: z.enum(SEASONS),
  subSeason: z.string().min(1),
  toneType: z.enum(TONE_TYPES),
  brightness: z.enum(BRIGHTNESS),
  saturation: z.enum(SATURATIONS),
  contrastScale: z.enum(CONTRAST_SCALES),
  faceShape: z.enum(FACE_SHAPES),
  bodyType: z.enum(BODY_TYPES),
  primarySwatches: z.array(SwatchSchema).length(4),
  secondarySwatches: z.array(SwatchSchema).length(4),
  avoidColors: z.array(z.string().min(1)).length(3),
  beautyMap: z.object({
    hair: z.string().min(1),
    lip: z.string().min(1),
    base: z.string().min(1),
  }),
  fabrication: z.array(z.string().min(1)).length(3),
  accessories: z.array(z.string().min(1)).length(3),
  denimRegistry: z.array(z.string().min(1)).length(2),
  stylistNote: z.string().min(1),
  fullPalette: z
    .array(z.string().regex(/^#[0-9A-Fa-f]{6}$/))
    .length(20)
    .optional(),
  detectedLighting: z.string().min(1).optional(),
  calculatedUndertone: z.string().min(1).optional(),
  confidenceScore: z.number().min(1).max(100).optional(),
  confidenceLabel: z.string().optional(),
  /** Her hair as it looks today, read in Pass 2. Null when it cannot be seen
   * (covered, out of the photo): never a guess. Absent when the model left it
   * out or answered off the list. */
  hairColor: z.enum(HAIR_COLORS).nullable().optional(),
  /** How light or deep her skin is after the light correction, read in Pass 2. */
  skinDepth: z.enum(SKIN_DEPTHS).optional(),
});

export type StudioColorProfile = z.infer<typeof StudioColorProfileSchema>;

// The two schemas below read the model's reply. Structured output is
// requested, but not every provider behind a model enforces it, so a reply
// can carry a right answer in the wrong form: "Autumn Deep" for AUTUMN_DEEP,
// "Oval" for "Oval Frame", 0.82 for 82. Those forms are mapped to the
// canonical value; anything that maps to nothing, or to more than one value,
// is still refused.
const canonical = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Case and spacing variants always map. `byFirstWord` also maps a value's
 * unique first word, for lists where that word alone names it ("Oval" is
 * "Oval Frame") — never where it would pick one cause among several ("cool"
 * light is not necessarily a fluorescent tube). */
function modelEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  options: { byFirstWord?: boolean } = {},
) {
  return z.preprocess((raw) => {
    if (typeof raw !== "string") return raw;
    const key = canonical(raw);
    const exact = values.find((value) => canonical(value) === key);
    if (exact || !options.byFirstWord) return exact ?? raw;
    const byFirstWord = values.filter((value) => canonical(value.split(/[\s_-]/)[0]) === key);
    return byFirstWord.length === 1 ? byFirstWord[0] : raw;
  }, z.enum(values));
}

/** A 1–100 score: numeric strings are read as numbers, a 0–1 fraction as a
 * percentage, and anything else is rounded and clamped into range. The
 * Pass-2 prompt itself asks for contrast to be cut by 40 points or 30%,
 * which can land at or below zero. */
const modelScore = z.preprocess((raw) => {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return raw;
  const percent = n > 0 && n < 1 ? n * 100 : n;
  return Math.min(100, Math.max(1, Math.round(percent)));
}, z.number().min(1).max(100));

const SlimVisionSchema = z.object({
  season: modelEnum(SEASON_KEYS),
  contrastScore: modelScore,
  undertone: modelEnum(["Warm", "Cool", "Neutral"]),
  faceShape: modelEnum(FACE_SHAPES, { byFirstWord: true }),
  bodyType: modelEnum(BODY_TYPES, { byFirstWord: true }),
  stylistNote: z.string().min(1),
  detectedLighting: z.string().min(1),
  calculatedUndertone: z.string().min(1),
  confidenceScore: modelScore,
  // Optional, and a value off the list (or a missing one) is dropped rather
  // than failing a good season read or spending its retry.
  // Null is her hair not being visible (D-W1 review M-4), kept as null.
  hairColor: z
    .union([z.null(), modelEnum(HAIR_COLORS)])
    .optional()
    .catch(undefined),
  skinDepth: modelEnum(SKIN_DEPTHS).optional().catch(undefined),
});

const AMBIENT_LIGHTING_VALUES = [
  "backlit",
  "warm_lamp",
  "cool_fluorescent",
  "clear_daylight",
  "dim_indoor",
  "mixed",
] as const;
const BIOLOGICAL_UNDERTONE_VALUES = [
  "warm_gold",
  "warm_peach",
  "cool_pink",
  "cool_blue",
  "neutral",
] as const;
const COMPUTED_CONTRAST_VALUES = ["low", "low-medium", "medium", "high"] as const;

const CalibrationSchema = z.object({
  ambientLighting: modelEnum(AMBIENT_LIGHTING_VALUES),
  biologicalUndertone: modelEnum(BIOLOGICAL_UNDERTONE_VALUES),
  computedContrast: modelEnum(COMPUTED_CONTRAST_VALUES),
});
type Calibration = z.infer<typeof CalibrationSchema> & {
  sensorClippingEvent: boolean;
  notes: string[];
};

const calibrationTool = {
  function: {
    name: "report_calibration",
    parameters: {
      type: "object",
      properties: {
        ambientLighting: {
          type: "string",
          enum: AMBIENT_LIGHTING_VALUES as unknown as string[],
          description:
            "Room lighting layout. 'backlit' = bright source behind subject; 'warm_lamp' = overhead tungsten/yellow LED bleed; 'cool_fluorescent' = cool office-grade wash; 'clear_daylight' = balanced neutral daylight; 'dim_indoor' = low-light tungsten; 'mixed' = competing color casts.",
        },
        biologicalUndertone: {
          type: "string",
          enum: BIOLOGICAL_UNDERTONE_VALUES as unknown as string[],
          description:
            "Skin undertone read from cheek apex, jawline and capillary flush AFTER mentally subtracting lighting cast (use sclera/teeth as white-balance anchor).",
        },
        computedContrast: {
          type: "string",
          enum: COMPUTED_CONTRAST_VALUES as unknown as string[],
          description:
            "Feature contrast index between hair, skin and eyes — measured from the truest non-shadowed facial pixels, not from silhouettes.",
        },
      },
      required: ["ambientLighting", "biologicalUndertone", "computedContrast"],
      additionalProperties: false,
    },
  },
};

const slimTool = {
  function: {
    name: "report_studio_color_profile",
    parameters: {
      type: "object",
      properties: {
        season: {
          type: "string",
          enum: SEASON_KEYS as unknown as string[],
          description: "Diagnosed 16-PCCS season key.",
        },
        contrastScore: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description: "Linear feature contrast index between hair, skin, and eyes.",
        },
        undertone: {
          type: "string",
          enum: ["Warm", "Cool", "Neutral"],
          description: "Dominant skin undertone read from sub-surface capillary warmth.",
        },
        faceShape: { type: "string", enum: FACE_SHAPES as unknown as string[] },
        bodyType: { type: "string", enum: BODY_TYPES as unknown as string[] },
        stylistNote: {
          type: "string",
          description:
            "Warm, human-sounding 2-sentence note from an expert analyst explaining why the client's face framing fits this season.",
        },
        detectedLighting: {
          type: "string",
          description:
            "Triage debug — short label for the room's lighting profile (e.g. 'Backlit Window Glare', 'Harsh Yellow Lamps', 'Ideal Daylight').",
        },
        calculatedUndertone: {
          type: "string",
          description:
            "Triage debug — isolated base temperature after factoring out lighting noise (e.g. 'True Warm', 'True Cool', 'Neutral-Warm', 'Neutral-Cool').",
        },
        confidenceScore: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description:
            "Triage debug — 1–100 confidence in the final season call, based on how cleanly the landmark pixels (cheek apex, iris root, eyebrow root) read after lighting noise was cancelled. Lower this when backlight or warm bleed forced heavy reconstruction.",
        },
        // src: https://developers.openai.com/api/docs/guides/structured-outputs (a nullable
        //   enum in a strict schema: type ["string", "null"] with null in the enum) · 2026-10-07
        hairColor: {
          type: ["string", "null"],
          enum: [...HAIR_COLORS, null],
          description:
            "Her hair as it looks today, dyed or natural; null when her hair is covered or out of the photo.",
        },
        skinDepth: {
          type: "string",
          enum: SKIN_DEPTHS as unknown as string[],
          description: "How light or deep her skin is after the light correction.",
        },
      },
      required: [
        "season",
        "contrastScore",
        "undertone",
        "faceShape",
        "bodyType",
        "stylistNote",
        "detectedLighting",
        "calculatedUndertone",
        "confidenceScore",
        "hairColor",
        "skinDepth",
      ],
      additionalProperties: false,
    },
  },
};

export type ColorAnalysisResult =
  | {
      success: true;
      profile: StudioColorProfile;
      telemetry: {
        pass1Raw: {
          ambientLighting: string;
          biologicalUndertone: string;
          computedContrast: string;
        };
        interceptTriggered: boolean;
        gatekeeperNotes: string[];
        pass2OverrideInputs: {
          ambientLighting: string;
          biologicalUndertone: string;
          computedContrast: string;
          sensorClippingEvent: boolean;
        };
        forcedDiagnostic: boolean;
      };
      /** The generation job that holds this read (absent on the legacy path). */
      jobId?: string;
    }
  | { success: false; error: string };

const PARSING_FAILED: ColorAnalysisResult = { success: false, error: "ANALYSIS_PARSING_FAILED" };

type ColorReadTelemetry = Extract<ColorAnalysisResult, { success: true }>["telemetry"];

const TelemetrySchema: z.ZodType<ColorReadTelemetry> = z.object({
  pass1Raw: z.object({
    ambientLighting: z.string(),
    biologicalUndertone: z.string(),
    computedContrast: z.string(),
  }),
  interceptTriggered: z.boolean(),
  gatekeeperNotes: z.array(z.string()),
  pass2OverrideInputs: z.object({
    ambientLighting: z.string(),
    biologicalUndertone: z.string(),
    computedContrast: z.string(),
    sensorClippingEvent: z.boolean(),
  }),
  forcedDiagnostic: z.boolean(),
});

/** What a succeeded `color_read` job keeps: the read, never the photo. A
 * stored hair colour or skin depth that is no longer on its list (a later
 * rename) never fails a paid replay (D-W1 review M-2): the hair colour
 * replays as null and the skin depth as absent. */
const StoredReadSchema = z.object({
  profile: StudioColorProfileSchema.extend({
    hairColor: z.enum(HAIR_COLORS).nullable().optional().catch(null),
    skinDepth: z.enum(SKIN_DEPTHS).optional().catch(undefined),
  }),
  telemetry: TelemetrySchema,
});

/** The answer a replay gives, rebuilt from the job's stored result and
 * checked before it is trusted. */
function readFromStored(result: Json | null): ColorAnalysisResult {
  const parsed = StoredReadSchema.safeParse(result);
  if (!parsed.success) {
    console.error(
      "[analyzePersonalColor] a stored read no longer validates",
      parsed.error.flatten(),
    );
    return { success: false, error: "SERVER_GATEWAY_TIMEOUT" };
  }
  return { success: true, profile: parsed.data.profile, telemetry: parsed.data.telemetry };
}

/** Every code this read answers with, which both clients already map. */
const MEMBER_ERROR_CODES: ReadonlySet<string> = new Set([
  "CONFIG_MISSING_API_KEY",
  "ANALYSIS_RATE_LIMITED",
  "ANALYSIS_CREDITS_EXHAUSTED",
  "ANALYSIS_PARSING_FAILED",
  "ANALYSIS_GATEWAY_FAILURE",
  "SERVER_GATEWAY_TIMEOUT",
  INSUFFICIENT_CREDITS,
]);

/** A failed job's code as one the clients map. The read's own codes pass
 * through; the job wrapper's own (`deadline_exceeded`, a thrown error's name,
 * `persist_failed_delivered`) read as the read running long, exactly as an
 * unhandled error does today. */
function memberErrorCode(errorCode: string): string {
  return MEMBER_ERROR_CODES.has(errorCode) ? errorCode : "SERVER_GATEWAY_TIMEOUT";
}

/** The photo's fingerprint for the job row (plan R-4): the first 16 hex of
 * the SHA-256 of the base64 text. The photo itself is never stored. */
async function photoDigest(imageBase64: string): Promise<string> {
  // src: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest · Web Crypto,
  //   global in Node 20+ and Bun 1.3; base64 text is ASCII, so these bytes are its UTF-8.
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(imageBase64));
  return Array.from(new Uint8Array(hash).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * The only provider answers that hand the hourly slot back: refusals before
 * generation that she cannot cause herself (our key, our provider credit, a
 * retired model, the provider's own rate limit or outage).
 *
 * Every other answer keeps the slot (D-W1 review I-1):
 * - a reply (ok, or ai.server's 502: no text or unusable JSON) and the
 *   timeouts (408, 504, 524) may have been billed;
 * - 400 and 403 (and 413, 422, anything unknown) bill nothing but she can
 *   cause them with a corrupt or flagged image, so releasing them would let
 *   bad photos loop past the 10-an-hour cap.
 */
// src: https://openrouter.ai/docs/api-reference/errors · OpenRouter API (2026-10-07): 400
//   invalid or missing parameters, 401 invalid credentials, 402 insufficient credits, 403
//   guardrail or moderation flag, 408 timeout, 429 rate limited, 502 model down or invalid
//   response, 503 no available provider; after a 200, failures are reported in the body.
const UNBILLED_REFUSALS: ReadonlySet<number> = new Set([401, 402, 404, 429, 500, 503]);

function analysisFailure(status: number): ColorAnalysisResult {
  if (status === 429) return { success: false, error: "ANALYSIS_RATE_LIMITED" };
  if (status === 402) return { success: false, error: "ANALYSIS_CREDITS_EXHAUSTED" };
  if (status === 502) return PARSING_FAILED;
  return { success: false, error: "ANALYSIS_GATEWAY_FAILURE" };
}

/** Both passes and the one retry finish inside this: under mobile's 180s
 * client timeout, since a read that lands after the client gave up still
 * spends the founding read. */
const COLOR_READ_DEADLINE_MS = 165_000;
/** The gateway's own per-call ceiling (TIMEOUT_MS in ai.server). */
const PASS_TIMEOUT_MS = 110_000;
/** Below this a vision call can't plausibly finish (the 43s QA read made two). */
const MIN_PASS_MS = 30_000;

/** The clock the two passes share, started when the read begins. */
function createColorReadBudget(now: () => number) {
  const startedAt = now();
  const remainingMs = () => COLOR_READ_DEADLINE_MS - (now() - startedAt);
  let retryUsed = false;
  return {
    /** A pass's timeout: the gateway's ceiling, clamped to what's left. */
    passTimeout: () => Math.max(MIN_PASS_MS, Math.min(PASS_TIMEOUT_MS, remainingMs())),
    /** Claims the read's single retry: its timeout, or null when the retry is
     * spent or a plausible attempt doesn't fit beside `reserveMs`, the time
     * kept back for the passes still to come. */
    takeRetry: (reserveMs: number): number | null => {
      const availableMs = remainingMs() - reserveMs;
      if (retryUsed || availableMs < MIN_PASS_MS) return null;
      retryUsed = true;
      return Math.min(PASS_TIMEOUT_MS, availableMs);
    },
  };
}

export const PersonalColorAnalysisInput = z.object({
  imageBase64: z.string().min(1).max(15_000_000),
  diagnostics: z
    .object({
      forceCalibration: z
        .object({
          ambientLighting: z.enum(AMBIENT_LIGHTING_VALUES),
          biologicalUndertone: z.enum(BIOLOGICAL_UNDERTONE_VALUES),
          computedContrast: z.enum(COMPUTED_CONTRAST_VALUES),
        })
        .optional(),
    })
    .optional(),
  /** One per press: a double press or a retry after a lost answer reuses it
   * and replays the job instead of charging again. */
  clientRequestId: z.string().uuid().optional(),
});
export type PersonalColorAnalysisInputData = z.infer<typeof PersonalColorAnalysisInput>;

/** Writes the founding-read marker with the service role. Never throws: a
 * failed write is logged, and the member keeps the read they already have. */
async function markFoundingReadUsed(userId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: marked, error: markerError } = await supabaseAdmin
      .from("profiles")
      .update({ founding_color_read_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id");
    if (markerError) {
      console.error("[analyzePersonalColor] founding marker write failed:", markerError);
    } else if (!marked?.length) {
      console.error("[analyzePersonalColor] founding marker write matched no profile row");
    }
  } catch (markerEx) {
    console.error("[analyzePersonalColor] founding marker write threw:", markerEx);
  }
}

/**
 * The founding read, claimed before the AI call:
 * - claimed: this request moved the marker from NULL, so this read is free.
 *   `claimedAt` is the marker text exactly as the database returned it.
 * - taken: the marker was already set (another request won it a moment ago).
 * - error: the claim could not be written; never treated as free.
 */
export type FoundingReadClaim =
  { outcome: "claimed"; claimedAt: string } | { outcome: "taken" } | { outcome: "error" };

async function serviceRoleClient(): Promise<MilaSupabaseClient> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/**
 * Claims her once-ever free founding read for this request, atomically: one
 * conditional update, `founding_color_read_at IS NULL`, that only one request
 * can win. Under READ COMMITTED a second, concurrent update waits for the
 * first's row lock, then re-checks the condition and matches no row. Uses the
 * existing column, so it needs no migration. Never throws.
 */
// src: https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED
//   (UPDATE re-evaluates its WHERE against the row a concurrent transaction just
//   committed); the update/eq/is/select chain is the one body-scan.ts uses ·
//   @supabase/postgrest-js 2.110.0.
export async function claimFoundingColorRead(
  userId: string,
  admin: () => Promise<MilaSupabaseClient> = serviceRoleClient,
  now: () => number = Date.now,
): Promise<FoundingReadClaim> {
  try {
    const db = await admin();
    const { data, error } = await db
      .from("profiles")
      .update({ founding_color_read_at: new Date(now()).toISOString() })
      .eq("id", userId)
      .is("founding_color_read_at", null)
      .select("founding_color_read_at");
    if (error) {
      console.error("[analyzePersonalColor] founding claim failed:", error);
      return { outcome: "error" };
    }
    const claimedAt = data?.[0]?.founding_color_read_at;
    return typeof claimedAt === "string" && claimedAt.length > 0
      ? { outcome: "claimed", claimedAt }
      : { outcome: "taken" };
  } catch (err) {
    console.error("[analyzePersonalColor] founding claim threw:", err);
    return { outcome: "error" };
  }
}

/**
 * Hands a founding claim back after a read she did not receive, so her free
 * read is still there. Clears only this request's own claim (the marker
 * still holds `claimedAt`), so it can never undo a read that landed. Retried
 * once; never throws. If both attempts fail, the founding read stays spent:
 * logged loudly, since she was not given the read it stands for.
 */
export async function giveBackFoundingColorRead(
  userId: string,
  claimedAt: string,
  admin: () => Promise<MilaSupabaseClient> = serviceRoleClient,
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const db = await admin();
      const { error } = await db
        .from("profiles")
        .update({ founding_color_read_at: null })
        .eq("id", userId)
        .eq("founding_color_read_at", claimedAt)
        .select("id");
      if (!error) return;
      console.error(`[analyzePersonalColor] founding give-back failed (${attempt}/2):`, error);
    } catch (err) {
      console.error(`[analyzePersonalColor] founding give-back threw (${attempt}/2):`, err);
    }
  }
  console.error("[analyzePersonalColor] founding read left spent after a read she did not get");
}

/** The collaborators the read calls out to, injectable for the tests. */
export type PersonalColorAnalysisDeps = {
  aiChatCompletion: typeof aiChatCompletion;
  isAiConfigured: typeof isAiConfigured;
  consumeRateLimit: typeof consumeRateLimit;
  withAiCredit: typeof withAiCredit;
  markFoundingRead: (userId: string) => Promise<void>;
  now: () => number;
  /** Runs the read as a `color_read` generation job (R7). */
  withGenerationJob: (
    spec: GenerationJobSpec<ColorAnalysisResult>,
    produce: (job: GenerationJobContext) => Promise<ColorAnalysisResult>,
  ) => Promise<GenerationJobOutcome<ColorAnalysisResult>>;
  /** The daily allowance a charged job's credit is taken against. */
  dailyAllowance: (supabase: MilaSupabaseClient, userId: string) => Promise<number>;
  /** Hands an hourly slot back to the window it was taken from. Never throws. */
  releaseRateLimit: (key: string, resetAt: RateLimitResult["reset_at"]) => Promise<boolean>;
  /**
   * The server-side dossier upsert, kept but off (plan R-10, owner question
   * Q1, coordinator ruling 2026-10-07). RLS refuses it for most members, and
   * where it lands it saves her read before she has confirmed it; both web
   * flows and mobile save the dossier from the client. Default false.
   */
  persistDossierOnServer?: boolean;
  /** Claims the founding read before the AI call (one request can win). */
  claimFoundingRead: (userId: string) => Promise<FoundingReadClaim>;
  /** Hands this request's own founding claim back. Never throws. */
  giveBackFoundingRead: (userId: string, claimedAt: string) => Promise<void>;
};

const defaultDeps: PersonalColorAnalysisDeps = {
  aiChatCompletion,
  isAiConfigured,
  consumeRateLimit,
  withAiCredit,
  markFoundingRead: markFoundingReadUsed,
  now: Date.now,
  withGenerationJob,
  dailyAllowance: resolveDailyAllowance,
  releaseRateLimit,
  persistDossierOnServer: false,
  claimFoundingRead: (userId) => claimFoundingColorRead(userId),
  giveBackFoundingRead: (userId, claimedAt) => giveBackFoundingColorRead(userId, claimedAt),
};

export async function analyzePersonalColorForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: PersonalColorAnalysisInputData,
  deps: PersonalColorAnalysisDeps = defaultDeps,
): Promise<ColorAnalysisResult> {
  const rateKey = `ai:analyzePersonalColor:${userId}`;
  /** The window this request's hourly slot was taken from: the exact
   * `reset_at` text, never parsed (a Date would lose its microseconds and
   * match no window). Null until a slot is taken. */
  let chargedWindow: RateLimitResult["reset_at"] | null = null;
  /** Provider calls this request made, and how many of them were refused
   * before generating anything. */
  const providerCalls = { made: 0, unbilled: 0 };
  /** True once this request's own produce ran: a request answered from
   * another request's job (a replay, an attach) never ran it. */
  let producedHere = false;
  let slotReleased = false;
  /** This request's founding claim (the marker text it wrote), or null when
   * it holds none. Settled once: kept for a read she received, otherwise
   * handed back. */
  let foundingClaim: string | null = null;
  let foundingSettled = false;
  const settleFoundingClaim = async (received: boolean) => {
    if (foundingClaim === null || foundingSettled) return;
    foundingSettled = true;
    try {
      // Kept: the marker then records when the founding read produced a
      // dossier (the column's meaning), not just when it was claimed.
      if (received) await deps.markFoundingRead(userId);
      else await deps.giveBackFoundingRead(userId, foundingClaim);
    } catch (err) {
      // Both defaults never throw; a kept claim stays spent either way.
      console.error("[analyzePersonalColor] settling the founding claim failed", err);
    }
  };
  /** Plan R-2 as amended (D-W0 review I-3, D-W1 review I-1): this request's
   * hourly slot comes back only when every call it made was a refusal she
   * cannot cause, and at most once, so bad photos never loop past the cap. */
  const releaseSlotUnlessBilled = async () => {
    if (slotReleased || chargedWindow === null) return;
    if (providerCalls.made > providerCalls.unbilled) return;
    slotReleased = true;
    try {
      await deps.releaseRateLimit(rateKey, chargedWindow);
    } catch (err) {
      // The default never throws; the slot then simply stays spent.
      console.error("[analyzePersonalColor] the hourly slot could not be handed back", err);
    }
  };

  try {
    if (!deps.isAiConfigured()) {
      console.error("[analyzePersonalColor] AI provider not configured (OPENROUTER_API_KEY)");
      return { success: false, error: "CONFIG_MISSING_API_KEY" };
    }

    try {
      const taken = await deps.consumeRateLimit(rateKey, {
        limit: 10,
        windowSeconds: 3600,
      });
      chargedWindow = taken.reset_at;
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        return { success: false, error: "ANALYSIS_RATE_LIMITED" };
      }
      throw err;
    }

    try {
      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select("skin_undertone, color_season, color_profile, founding_color_read_at")
        .eq("id", userId)
        .maybeSingle();
      if (profileError || !profileRow) {
        // Fail closed: a check that could not be read, or found no row, is
        // never "founding read unused". Treating it as free let a failing
        // read hand out free AI reads, and a member with no row could never
        // have the marker written. Nothing has been called or charged yet.
        console.error(
          "[analyzePersonalColor] founding-read check failed:",
          profileError ?? "no profile row",
        );
        await releaseSlotUnlessBilled();
        return { success: false, error: "SERVER_GATEWAY_TIMEOUT" };
      }

      // The founding read is free — once, ever. Whether it was used is read
      // from `profiles.founding_color_read_at`, a service-role-only column:
      // inferring it from the dossier columns themselves let a member clear
      // them through PostgREST and farm the free AI read without a limit
      // beyond the hourly rate cap (QA MW-10). A member at onboarding step 1
      // has no subscription and DEFAULT_AI_CREDITS is 0, so charging the scan
      // the whole dossier depends on would dead-end the flow that everything
      // else builds on. Once the marker is set, re-reads charge a credit as
      // before (and refund it if the read fails).
      const foundingUnused = !profileRow?.founding_color_read_at;
      if (foundingUnused) {
        // Claimed before the AI call, atomically, so two reads racing can
        // never both be free; handed back if she does not receive the read.
        const claim = await deps.claimFoundingRead(userId);
        if (claim.outcome === "error") {
          // Fail closed, as above: nothing called or charged yet.
          await releaseSlotUnlessBilled();
          return { success: false, error: "SERVER_GATEWAY_TIMEOUT" };
        }
        if (claim.outcome === "taken") {
          // Another read of hers claimed it a moment ago and is most likely
          // still running: ask her to wait rather than charge her. Tied to
          // that read, so this slot stays spent (as for an in-flight read).
          console.warn("[analyzePersonalColor] the founding read was claimed by another read");
          return { success: false, error: "SERVER_GATEWAY_TIMEOUT" };
        }
        foundingClaim = claim.claimedAt;
      }
      const foundingRead = foundingClaim !== null;

      // `stillRunning` is the job's write guard (always true on the legacy
      // path, which has no job).
      const produceRead = async ({
        stillRunning,
      }: GenerationWriteGuard): Promise<ColorAnalysisResult> => {
        producedHere = true;
        const budget = createColorReadBudget(deps.now);
        const callGateway = async (
          systemPrompt: string,
          userText: string,
          toolDef: typeof slimTool | typeof calibrationTool,
          timeoutMs: number,
        ): Promise<AiResult> => {
          // Counted against the slot from the moment it is sent, until its
          // answer is a refusal she cannot cause (a throw stays counted).
          providerCalls.made += 1;
          const res = await deps.aiChatCompletion(
            [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: [
                  { type: "text", text: userText },
                  {
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${data.imageBase64}` },
                  },
                ],
              },
            ],
            toolDef,
            { supabase: supabase, userId: userId },
            { timeoutMs },
          );
          if (!res.ok && UNBILLED_REFUSALS.has(res.status)) providerCalls.unbilled += 1;
          return res;
        };

        // One pass of the read. A reply that can't be used — no text, not
        // JSON, or JSON outside the schema (the gateway reports the first two
        // as 502) — gets the read's single retry while the budget allows,
        // keeping `reserveMs` back for the passes still to come; timeouts,
        // rate limits and provider credit errors are final.
        const runPass = async <T>(
          label: string,
          schema: z.ZodType<T, z.ZodTypeDef, unknown>,
          reserveMs: number,
          call: (timeoutMs: number) => Promise<AiResult>,
        ): Promise<{ ok: true; data: T } | { ok: false; failure: ColorAnalysisResult }> => {
          const attempt = async (timeoutMs: number) => {
            const res = await call(timeoutMs);
            if (!res.ok) {
              return {
                ok: false as const,
                failure: analysisFailure(res.status),
                retryable: res.status === 502,
              };
            }
            const parsed = schema.safeParse(res.args);
            if (parsed.success) return { ok: true as const, data: parsed.data };
            console.error(
              `[analyzePersonalColor] ${label} schema mismatch`,
              parsed.error.flatten(),
            );
            return { ok: false as const, failure: PARSING_FAILED, retryable: true };
          };

          const first = await attempt(budget.passTimeout());
          if (first.ok || !first.retryable) return first;
          const retryTimeoutMs = budget.takeRetry(reserveMs);
          if (retryTimeoutMs === null) return first;
          console.warn(`[analyzePersonalColor] ${label} reply was unusable; retrying once`);
          return attempt(retryTimeoutMs);
        };

        const forced = data.diagnostics?.forceCalibration;
        let pass1Parsed: { success: true; data: z.infer<typeof CalibrationSchema> };
        if (forced) {
          pass1Parsed = { success: true, data: forced };
        } else {
          const calibrationPrompt = `You are the front-end CALIBRATION sensor for a Seoul color studio. Your only job is to read the raw environment + skin of THIS portrait and return three normalized metrics. You DO NOT pick a seasonal palette — a second model handles that downstream.

Execute silently:
1. Profile the room lighting. Identify backlight (bright source behind the subject), warm overhead lamp bleed, cool fluorescent wash, neutral daylight, dim indoor tungsten, or a mixed cast. Use sclera and teeth as the white-balance anchor — any yellow/blue shift on those neutral-white surfaces is pure lighting bleed.
2. After mentally subtracting the lighting cast, read the BIOLOGICAL skin undertone from the cheek apex, jawline, and capillary flush. Pick: warm_gold, warm_peach, cool_pink, cool_blue, or neutral. Be honest — if signals conflict, return "neutral".
3. Measure feature contrast between hair, skin, and eyes using the truest NON-SHADOWED facial pixels (forehead, cheek apex). Never grade contrast from silhouettes against a bright background. Return one of: low, low-medium, medium, high.

Return ONLY by calling the report_calibration tool.`;

          const pass1 = await runPass("Pass1", CalibrationSchema, MIN_PASS_MS, (timeoutMs) =>
            callGateway(
              calibrationPrompt,
              "Run the Pass-1 calibration read on this portrait.",
              calibrationTool,
              timeoutMs,
            ),
          );
          if (!pass1.ok) return pass1.failure;
          pass1Parsed = { success: true, data: pass1.data };
        }

        const pass1Raw = { ...pass1Parsed.data };

        const calibration: Calibration = {
          ...pass1Parsed.data,
          sensorClippingEvent: false,
          notes: [],
        };

        if (calibration.ambientLighting === "backlit") {
          if (
            calibration.computedContrast === "high" ||
            calibration.computedContrast === "medium"
          ) {
            calibration.notes.push(
              `Backlight detected — clamped computedContrast from "${calibration.computedContrast}" to "low-medium".`,
            );
            calibration.computedContrast = "low-medium";
          }
          calibration.sensorClippingEvent = true;
        }

        if (calibration.biologicalUndertone === "neutral") {
          calibration.sensorClippingEvent = true;
          calibration.notes.push(
            "Neutral undertone read — flag sensorClippingEvent, lean on hair-root / iris-root anchors.",
          );
        }

        const warmAmbient = calibration.ambientLighting === "warm_lamp";
        const coolAmbient = calibration.ambientLighting === "cool_fluorescent";
        const coolBio =
          calibration.biologicalUndertone === "cool_pink" ||
          calibration.biologicalUndertone === "cool_blue";
        const warmBio =
          calibration.biologicalUndertone === "warm_gold" ||
          calibration.biologicalUndertone === "warm_peach";
        if ((warmAmbient && coolBio) || (coolAmbient && warmBio)) {
          calibration.sensorClippingEvent = true;
          calibration.notes.push(
            `Conflicting ambient (${calibration.ambientLighting}) vs biological (${calibration.biologicalUndertone}) — sensorClippingEvent.`,
          );
        }

        const calibrationBlock = `=== VALIDATED PASS-1 CALIBRATION OVERRIDES (AUTHORITATIVE) ===
ambientLighting        : ${calibration.ambientLighting}
biologicalUndertone    : ${calibration.biologicalUndertone}
computedContrast       : ${calibration.computedContrast}
sensorClippingEvent    : ${calibration.sensorClippingEvent ? "TRUE" : "false"}
gatekeeperNotes        : ${calibration.notes.length ? calibration.notes.join(" | ") : "none"}

These values have already been white-balance-corrected and shadow-discounted by the upstream calibration sensor. You MUST use them as the source of truth — do NOT re-derive ambient lighting or contrast from raw pixels. If sensorClippingEvent is TRUE, you are forbidden from returning any WINTER_* key purely on the basis of visible darkness or contrast.`;

        const systemPrompt = `You are a master colorist at an Apgujeong, Seoul studio. Pass-1 calibration has already cleaned the environmental + biological signal for THIS portrait. Your ONLY job in Pass 2 is to map the validated calibration data + visible facial structure to a strict PCCS seasonal key.

${calibrationBlock}

=== STEP 1 — ENVIRONMENTAL LIGHT TRIAGE & NOISE CANCELLATION ===
Before reading any personal feature, profile the room's lighting and mathematically cancel out its noise:
  • BACKLIGHTING CHECK: If a bright window, lamp, or light source sits BEHIND the subject, the camera's auto-exposure has under-exposed the facial canvas and laid an artificial grayish, bluish, or muted shadow over the skin. Mentally lift that shadow and isolate the true sub-surface undertone — do NOT mistake the auto-exposure haze for a cool base.
  • WARM BLEED CHECK: If overhead tungsten / yellow LED lamps are casting an artificial amber tint across the whole frame (warm cast also dyeing the white wall behind the subject), do NOT mistake that lamp warmth for genuine skin warmth. Re-anchor on the neck/jaw boundary — that zone holds the truest neutral baseline because hair and lamp wash interfere least there.
  • SCLERA & TEETH WHITE-BALANCE ANCHOR: When a warm or yellow cast is detected, look strictly at the SCLERA (whites of the eyes) and the TEETH to recover a true neutral-white reference point. These two surfaces should read as pure neutral white in reality, so any yellow/amber/green shift seen on them is pure lighting bleed — subtract that same shift from every skin and hair reading before classifying.
  • Record the result for STEP 4 \`detectedLighting\` using one of: "Backlit Window Glare", "Harsh Yellow Lamps", "Cool Fluorescent Wash", "Ideal Daylight", "Dim Indoor Tungsten", or a similarly short descriptive label.

=== STEP 1.5 — BACKGROUND GLARE & SHADOW DISCOUNT RULE ===
CRITICAL CALIBRATION FOR BACKLIGHTING: If the image contains a bright light source or window behind the user, the camera will naturally force the face into deep shadow. Do NOT treat these lighting shadows as a low-lightness skin value or dark winter hair. You must mathematically discount the darkness of the shadows by looking at the truest, non-shadowed parts of the forehead or cheek apex (or any small unshadowed sliver of the nose bridge / upper lip). Reconstruct the subject's TRUE lightness, contrast, and hair pigment from those clean pixels — never from the silhouetted shadow zones.
  • If \`detectedLighting\` resolves to "Backlit Window Glare" (or any backlit variant), you MUST down-weight any "deep / dark / high-contrast" reading by one full step before entering STEP 3. A face that looks "deep + cool" only because of backlight is almost never WINTER_DEEP — it is most often SPRING_LIGHT, SUMMER_LIGHT, or AUTUMN_SOFT once the shadow is discounted.

=== STEP 1.6 — GLASSES GLARE CANCELLATION RULE ===
ANTI-ARTIFACT FILTER: Explicitly scan the image for eyeglasses or lenses. If there are blue, purple, or cool-toned reflections appearing on the lens glass (anti-reflective coatings, screen glare, sky bounce, fluorescent kick), you are COMMANDED to completely ignore those pixel clusters. Do NOT use lens reflections to calculate the skin undertone, the iris pigment, or the white-balance baseline. Treat the lens surface as a masked-out region and re-anchor temperature reads on cheek apex, jaw, and forehead skin pixels OUTSIDE the frame of the glasses. A cool reflection on glass is an optical artifact, NEVER evidence of a Winter undertone.

=== STEP 1.7 — HAIR VALUE CORRECTION (DARK-HAIR-AGAINST-BRIGHT-BACKGROUND OVERRIDE) ===
HAIR VALUE CORRECTION: If the subject has natural dark brown or dark charcoal hair framing their face against a bright or white background (white pillows, white bedding, bright wall, overexposed window), the camera's apparent high contrast is an EXPOSURE ILLUSION created by the background, not a true Winter physical trait. You MUST check the skin surface underneath. If the skin shows a delicate, low-contrast, creamy peach or soft translucent ivory undertone, OVERRIDE the dark hair metric: demote the contrast score from "High" to "Low-Medium" and route the profile directly AWAY from any Winter key and INTO SPRING_LIGHT (or SPRING_WARM / SUMMER_LIGHT if the discounted reads clearly point there). Dark hair alone is never sufficient evidence for Winter — the skin apex undertone always wins.

=== STEP 2.5 — EYE & IRIS CONTRAST DOUBLE-CHECK (ANTI-WINTER FALSE-POSITIVE) ===
Before assigning ANY Winter classification (WINTER_DEEP / WINTER_CLEAR / WINTER_TRUE / WINTER_COOL), look closely at the eyes and root hair colors under magnification. Winter REQUIRES a natural, pitch-black charcoal or pure icy-ash baseline in BOTH the iris and the hair roots. If the iris roots carry warm honey-amber threads, OR if the skin surface underneath the exposure shadow shows a delicate peach or golden-ivory quality, the high contrast you are seeing is an ILLUSION caused by the lighting. In that case you MUST immediately re-route the analysis to its true category — default to SPRING_LIGHT unless the discounted reads clearly land in SPRING_TRUE, SPRING_WARM, SPRING_BRIGHT, SUMMER_LIGHT, or AUTUMN_SOFT.

=== STEP 2.6 — PURE PCCS WINTER BOUNDARY VALIDATION ===
ABSOLUTE WINTER PURITY GATE: Under NO circumstances may any Winter key (WINTER_DEEP / WINTER_CLEAR / WINTER_TRUE / WINTER_COOL) be returned if the cheek apex shows ANY presence of golden, peach, or delicate apricot warmth — even faint — OR any soft diffusion / hazy low-edge transition across the midface. Winter skin is strictly cool AND high-clarity (snowy porcelain, blue-pink, ice-cool beige, or deep cool espresso). A single trace of warm sub-surface glow OR soft diffused haze disqualifies all four Winter keys.

DUAL-TRACK ROUTING AFTER WINTER DISQUALIFICATION: Once Winter is disqualified, do NOT default blindly to SPRING_LIGHT. Instead, measure the saturation (chroma) of the skin midtones BEFORE routing:
  • If midtone chroma is CLEAR / LUMINOUS with warm peach or golden carotene scatter ➔ route to SPRING_LIGHT (or SPRING_WARM / SPRING_BRIGHT if discounted reads land there).
  • If midtone chroma is LOW / DUSTY / ASHY with cool-neutral diffusion (no warm peach signal) ➔ route to SUMMER_MUTED (or SUMMER_LIGHT / SUMMER_COOL if discounted reads land there).
This boundary is non-negotiable and overrides every contrast, hair-depth, and lighting cue.

=== STEP 2.7 — BIOLOGICAL COLOR TEMPERATURE TRIANGULATION ===
Do not analyze skin tone in isolation. Instruct the AI to triangulate skin color against the inside of the lower lip and the natural gumline if visible. True Winter complexions carry a distinct blue-violet, cool berry underlying mucosa baseline. If the inner lip tissue maps to a warm coral, clear salmon, or bright peach-pink tone, the user is structurally WARM. This immediately invalidates any Winter or Summer classification, forcing the model back into the Spring or Autumn sorting paths.

=== STEP 2.8 — SCLERA CONTRAST NORMALIZATION ===
Analyze the sclera (whites of the eyes) to judge true physical contrast. True deep winters have an ultra-crisp, bright, almost blue-white sclera that creates an intense, clear boundary against a dark iris. If the sclera carries a soft, creamy ivory or gentle warm tint, the high contrast seen in the photo is an artificial camera exposure artifact. The model must normalize this and scale down the contrast index score by 30%.

=== STEP 2.9 — CHROMATIC SHADOW WEIGHTING ===
Examine the deepest folds of the facial shadows (such as the nasolabial folds or the shadow directly under the lower lip). If the shadow pixels carry a golden-brown or warm amber-grey cast, the skin baseline possesses a high yellow-red melanin count (Warm). If the shadow pixels carry an ashy, slate-blue, or pure charcoal cast, the baseline is Cool. The model must use this shadow-cast reading to verify its primary cheek apex undertone assignment.

=== STEP 2.10 — SUBCUTANEOUS CAPILLARY & FLUSH VERIFICATION ===
Analyze the relative color saturation of natural facial flush areas (the apples of the cheeks or the tip of the nose). In Cool seasons (Winter/Summer), skin flush presents as a cool, bluish-toned berry, violet-pink, or stark magenta. In Warm seasons (Spring/Autumn), skin flush presents as a radiant peach, light coral, or warm salmon. If the flush tissue carries even a microscopic trace of peach or coral under exposure shadows, you MUST invalidate all Winter results.

=== STEP 2.11 — SUB-DERMAL VEIN DIFFUSION ANALYSIS ===
Examine the wrist inner borders, temples, or thin-skinned areas around the eyes if visible. Instruct the model to analyze the light reflectance of superficial veins. A stark, vivid indigo or deep blue reflectance signals a Cool baseline. A diffused aquamarine, warm teal, or soft olive-green reflectance signals a Warm baseline. Cross-reference this reading with the primary cheek apex sample to ensure the undertone is chemically consistent.

=== STEP 2.12 — TRANSLUCENCY VS. OPACITY CALIBRATION ===
Differentiate between the structural skin properties of Spring Light and Winter Deep. Spring Light features a highly delicate, translucent, thin "glass-like" skin profile where light passes through and picks up warm carotene subcutaneous tones. Winter profiles feature a highly opaque, high-contrast, or dense matte melanin distribution. If the skin shows high surface translucency despite being in a dark, backlit environment, default immediately to the high-reflectance SPRING_LIGHT template.

=== STEP 2.13 — GLOBAL VS. LOCAL LUMINANCE RATIO CHECK ===
Analyze the brightest point of the background environment against the highest highlight point on the subject's face (the nasal bridge or forehead apex). If the background luminance is higher than the facial highlight by more than a 2:1 ratio, flag a "Severe Backlit Under-Exposure Event". In this state, the model must assume that all midtones and shadows on the face have been artificially cooled down and deepened by the device's sensor. The AI is forbidden from using global facial contrast to assign a Winter season during this event.

=== STEP 2.14 — CHROMATIC TRANSITION GRADIENT ANALYSIS ===
Examine the transition boundary where the cheekbone highlight transitions into a shadow. In True Winter/Summer profiles, this gradient transition is stark, sharp, and cold gray. In Spring Light profiles, even under bad lighting, the transition zone carries a microscopic warm gradient blur of soft peach, amber, or golden-gray light dispersion. If the highlight edge shows a soft, warm diffusion gradient rather than a razor-sharp cold drop-off, eliminate all Winter classifications immediately.

=== STEP 2.15 — IRIS CRYPT AND COLLARETTE STRUCTURAL CONTRAST ===
Force a deep analysis of the iris structure, independent of global facial shadows. Inspect the collarette and crypt zones of the eye iris if visible. True Spring Light individuals possess highly delicate, soft, clear fibers with light hazel, warm amber, or soft green-gold underlying patterns. True Winters possess deep, dense, high-opacity melanin blocks or crisp, ice-clear starburst rings with heavy dark borders. If the iris patterns show cloudy softness with a warm amber base, override any high contrast scores calculated from hair silhouettes and route directly to SPRING_LIGHT.

=== STEP 2.16 — SUB-PIXEL MELANIN VS. CAROTENE TEXTURE CLUMPING ===
Analyze the micro-texture of the skin surface under high magnification across the bridge of the nose and upper cheeks. True Winter profiles feature dense, highly packed, uniform melanin distributions that present as solid, opaque, sharp pixel structures even in low light. Spring Light profiles feature highly irregular, delicate, translucent carotene patterns that present as a soft, luminous, porous scattering of light. If the micro-texture maps to a translucent scattering pattern rather than a solid opaque block, the dark values are a camera illusion. Immediately invalidate any Winter or Summer result and route to SPRING_LIGHT.

=== STEP 2.17 — VERMILION BORDER SATURATION GRADIENT ===
Examine the vermilion border (the boundary line where the lips meet the surrounding skin). In True Winters, this boundary line is exceptionally sharp, high-contrast, and shifts crisply from skin to a cool pink/magenta lip base with zero transition blur. In Spring Light profiles, the vermilion border has a highly delicate, soft, warm-toned peach or coral blend gradient that gently diffuses into the surrounding skin. If the model detects a soft, warm diffusion gradient at the lip line rather than a sharp cold drop-off, a Winter classification is strictly forbidden.

=== STEP 2.18 — EYE WHITE (SCLERA) TO IRIS EDGE CONTRAST FREQUENCY ===
Examine the limbal ring (the dark ring around the iris) and how it transitions into the sclera (white of the eye). True Winters possess a high-frequency, razor-sharp edge contrast where the midnight-dark iris boundary stops and the bright blue-white eye white begins. Spring Light individuals possess a lower frequency, softer, or charcoal-hazel limbal boundary that blends smoothly with a creamy ivory or soft clear sclera. If the edge frequency of the eye boundary is soft and diffused, the global "high contrast" calculated from background silhouettes is an exposure error. Force a SPRING_LIGHT classification.

=== STEP 2 — STRICT LANDMARK PIXEL SAMPLING POINTS ===
Do not average the whole face — that blends lighting noise into the read. Sample ONLY these specific biological landmarks:
  • INNER CHEEK APEX (just under the eye, above the smile line) → base skin CLARITY and UNDERTONE VIBRANCY, away from jaw shadows.
      – Warm signal: delicate translucent peach-golden glow.
      – Cool signal: true blue-pink or porcelain cast.
  • OUTER JAWLINE & EAR TIPS → underlying VASCULAR TEMPERATURE confirmation only.
  • IRIS ROOT (the deep ring closest to the pupil) → this is the ANCHOR against camera-exposure illusions. Under magnification:
      – Golden-amber thread-bursts or warm hazel flecks → SPRING / AUTUMN keys.
      – Soft charcoal clouds, diffused grey-blue, velvet hazel → SUMMER keys.
      – Solid high-contrast midnight border, glass-like sapphire, true black pigment → WINTER keys.
  • NATURAL EYEBROW ROOTS (where the hair meets the skin, NOT the dyed tips) → true HAIR DEPTH and pigment temperature, ignoring any artificial camera contrast overrides or hair products.
  • Combine these reads into an isolated base temperature and record it for STEP 4 \`calculatedUndertone\` as one of: "True Warm", "True Cool", "Neutral-Warm", or "Neutral-Cool".

=== STEP 3 — ABSOLUTE METRIC ROUTING MATRIX (12 SEASONS) ===
Route the (Temperature × Lightness × Chroma) read through this strictly audited 12-season sorting system. Pick exactly ONE key. For every candidate, verify the subject matches ALL THREE: Core Physics, Feature Indicators, and the Salon Target family that would actually flatter them. If two seasons feel close, the Feature Indicators (eye pigment + natural hair undertone) are the tiebreaker — never the lighting cast.

ELIMINATION SHORTCUT (apply BEFORE walking the 12 sub-types — these are mandatory routing rails):
  • WARM (Peach / Gold) + High Lightness + Low-Med Contrast  ➔ SPRING_LIGHT. (If contrast LOOKS high but the iris carries warm amber threads, flag exposure illusion and FORCE SPRING_LIGHT.)
  • WARM + High Saturation + High Contrast                   ➔ SPRING_BRIGHT.
  • WARM + Pure Gold Saturation + Heavy Low-Lightness        ➔ AUTUMN_TRUE, AUTUMN_WARM, or AUTUMN_DEEP (deep = lower lightness + darker eyebrow root).
  • COOL (Pink / Blue) + Low Saturation + Low-Med Contrast   ➔ SUMMER_MUTED or SUMMER_LIGHT (light = higher lightness).
  • COOL + High Saturation + Stark Jewel Contrast            ➔ WINTER_TRUE, WINTER_COOL, or WINTER_CLEAR (clear = neon clarity, true/cool = pure jewel).
  • COOL + Low Lightness + Heavy Contrast (verified ink-black eyebrow roots) ➔ WINTER_DEEP.

■ SPRING GROUP — Warm Undertone, High Clarity
  • SPRING_LIGHT
      – Core Physics: Warm Temperature + High Lightness (Value) + Medium-Low Saturation (Chroma).
      – Feature Indicators: Translucent cream, ivory, or warm peach skin. Eyes clear, soft honey or light golden-brown. Natural hair carries clear warm golden-blonde or light milk-chocolate undertones.
      – Salon Targets: Soft warm pastels, peach, apricot, warm cream.
  • SPRING_BRIGHT (Clear Spring)
      – Core Physics: Warm-Neutral Temperature + High Saturation (Chroma) + High Contrast.
      – Feature Indicators: Highly luminous skin contrasting sharply with vivid sparkling eyes (sparkling blue, green, or bright topaz brown with highly defined iris rings). Natural hair medium-to-deep sparkling chestnut brown.
      – Salon Targets: Vivid coral, bright poppy red, high-shine warm fuchsia, clear bright yellow.
  • SPRING_WARM (True Spring)
      – Core Physics: Pure Warm Temperature + Medium-High Saturation (Chroma) + Balanced Lightness.
      – Feature Indicators: Radiant bronze, rich golden, or deep apricot skin. Eyes deep olive, warm hazel, or bright amber brown with warm thread-burst pattern. Hair rich copper red to sunny golden brown.
      – Salon Targets: Terracotta, bright coral salmon, rich apricot cream, tomato red.

■ SUMMER GROUP — Cool Undertone, Muted & Milky
  • SUMMER_LIGHT
      – Core Physics: Cool Temperature + High Lightness (Value) + Medium-Low Saturation (Chroma).
      – Feature Indicators: Milky porcelain, translucent rosy-pink, or pale cool-beige skin. Eyes clear-but-soft icy blue, grey, or soft slate-hazel. Natural hair light ash blonde to soft cool ash brown.
      – Salon Targets: Icy pastels, milky orchid pink, soft lavender pink, pale cool rose.
  • SUMMER_MUTED (Soft Summer)
      – Core Physics: Cool-Neutral Temperature + Low Saturation (Chroma) + Low-Medium Contrast.
      – Feature Indicators: Soft hazy cool skin with olive or neutral-cool undertone. Eyes cloud-like, velvety grey-blue, muted hazel, or soft ashy brown. Natural hair has ZERO golden hints — distinctly slate, charcoal-grey, or soft dusty cocoa.
      – Salon Targets: Muted deep mauve, dusty wood rose, cool taupe, smokey slate-blue.
  • SUMMER_COOL (True Summer)
      – Core Physics: Pure Cool Temperature + Medium-High Contrast + Matte Saturation.
      – Feature Indicators: Distinct pink, blue-grey, or cool-beige skin base. Eyes striking cool blue, crystal grey, or dark oceanic slate. Natural hair dark ash brown, charcoal grey, or deep cool matte brown — no red/gold tones.
      – Salon Targets: Classic berry pink, cool orchid magenta, slate grey, cascading cool denim.

■ AUTUMN GROUP — Warm Undertone, Earthy & Muted
  • AUTUMN_SOFT (Soft Autumn)
      – Core Physics: Warm-Neutral Temperature + Low Saturation (Chroma) + Low-Medium Contrast.
      – Feature Indicators: Soft matte neutral-warm skin (gentle beige or soft khaki-olive undertone). Eyes soft cloudy amber, muted olive green, or soft hazel-brown. Hair muted ash-gold blonde, soft ginger, or light matte chestnut.
      – Salon Targets: Soft warm nude beige, muted ginger, toasted camel, soft khaki olive.
  • AUTUMN_DEEP (Dark Autumn)
      – Core Physics: Warm Temperature + Low Lightness (Value/Deep) + High Contrast.
      – Feature Indicators: Rich velvet bronze, golden-tan, or deep warm olive skin. Eyes deep chocolate brown, espresso black, or dark forest olive with high pigment depth. Hair deep dark espresso, mahogany, or velvet warm black.
      – Salon Targets: Deep brick red, dark maple, rich espresso berry, warm copper-bronze.
  • AUTUMN_WARM (True Autumn)
      – Core Physics: Pure Warm Temperature + High Saturation (Chroma/Spicy) + Heavy Low-Lightness.
      – Feature Indicators: Unmistakable warm golden-orange, rich amber, or deep peachy skin base. Eyes striking dark amber, warm tawny brown, or true golden-green. Hair intense fiery copper red, deep golden mahogany, or rich auburn.
      – Salon Targets: Burnt pumpkin spice, rich warm ochre, fiery terracotta matte, deep forest olive.

■ WINTER GROUP — Cool Undertone, High Contrast & Vivid
  • WINTER_DEEP (Dark Winter)
      – Core Physics: Cool Temperature + Low Lightness (Value/Deep) + High Contrast.
      – Feature Indicators: Stark cool skin running from snowy porcelain to deep espresso-cool, contrasting heavily with features. Eyes deep midnight black, dark charcoal grey, or icy black-brown. Hair solid jet black or deep midnight charcoal.
      – Salon Targets: Deep plum berry, dark cherry wine red, rich cold burgundy, midnight charcoal.
  • WINTER_CLEAR (Clear Winter)
      – Core Physics: Cool-Neutral Temperature + High Saturation (Chroma) + Extreme Sharp Contrast.
      – Feature Indicators: Ultra-clear high-transparency cool skin dramatically framing the features. Eyes intense glass-like sapphire blue, electric violet, or striking crystal dark brown. Hair ultra-glossy piano black or stark platinum.
      – Salon Targets: Electric neon fuchsia, high-gloss crimson red, brilliant mirror diamond, stark silver.
  • WINTER_COOL (True Winter)
      – Core Physics: Pure Cool Temperature + Crisp Clarity + Jewel Contrast.
      – Feature Indicators: Striking blue-pink, snowy white, or ice-cool beige complexion. Eyes royal sapphire, true cold grey, or deep cool icy brown. Hair natural stark black, blue-black, or deep cool ash-charcoal black.
      – Salon Targets: Royal ruby red, pure magenta pink, crisp frost white, deep royal violet.

=== STEP 3.5 — LIGHTNESS VALUE PRIORITY GATE FOR SPRING LIGHT ===
CRITICAL BINDING RULE: Recognize that "Spring Light" complexions have high spatial reflectance. When a high-reflectance face is backlit, camera sensors over-compensate by aggressively cooling down the skin values to grey. If the AI detects a high-reflectance skin area combined with a low-lightness shadow profile, it must flag a "Sensor Clipping Event" and automatically favor a SPRING_LIGHT diagnosis over a Winter or Summer option.

=== STEP 3.6 — CONTRAST RATIO SANITY CHECK ===
CRITICAL LOGIC OVERRIDE: Before finalizing a Winter classification based on a high contrast score, run a sanity check against hair reflectivity. If the hair looks dark but has warm golden-brown or copper highlights where the backlight hits it, it is NOT a cool winter black. It is a warm deep brown being compressed by the camera sensor. Immediately strip 40 points from the feature contrast index and route the user to SPRING_LIGHT.

=== STEP 3.7 — THE AMBIENT NOISE SANITY CHECK ===
CRITICAL BINDING LOGIC: If the calculated undertone reads as "Cool" but the environmental triage flags a "Yellow Overhead Lamp Cast", "Screen Blue-Light Bleed", or backlit glare, the color data is fundamentally corrupted by ambient noise. The model must trigger a DUAL-LANE safety fallback that inspects the hair-root and eyebrow-root undertones (which are far less sensitive to ambient color cast than skin pixels) before choosing a final season:
  • LANE A — If hair / eyebrow roots lean distinctly WARM, golden, honey, or peachy-clear, force SPRING_LIGHT.
  • LANE B — If hair / eyebrow roots lean distinctly ASHY, mousy, charcoal, or slate-grey with no warm threads, force SUMMER_MUTED.
Never collapse both lanes into SPRING_LIGHT by default — the lane decision must be data-driven from the hair-root reading.

=== STEP 3.8 — ABSOLUTE HARDWARE-DECEPTION INTERCEPT RAIL ===
CRITICAL PROGRAMMATIC OVERRIDE: If the image analysis yields an initial result of Winter Deep, Winter Cool, or Summer Muted, but the local landmark checks detect ANY combination of a diffused vermilion border gradient, translucent carotene scattering, or warm peach-pink capillary flush under the cheek apex, the model MUST declare a "Hardware Deception Event". It is commanded to completely discard the initial cool/dark assessment, strip the contrast score down to "Low-Medium", and force the final output key to resolve strictly to SPRING_LIGHT.

The returned \`season\` field MUST be a VERBATIM match for exactly one of these keys (anything else fails to hydrate the 5×4 dot matrix):
  ${SEASON_KEYS.join(", ")}

=== STEP 4 — EXPOSE TRIAGE DEBUG PARAMETERS ===
Populate the tool payload exactly so the UI can log the system's thought process:
  • \`detectedLighting\`     — short label for the room's lighting layout from STEP 1.
  • \`calculatedUndertone\`  — the isolated base temperature from STEP 2 ("True Warm" / "True Cool" / "Neutral-Warm" / "Neutral-Cool").
  • \`confidenceScore\`      — integer 1–100 reflecting how cleanly the landmark pixels (cheek apex, iris root, eyebrow root) resolved AFTER the lighting noise was subtracted. Drop the score when backlight or warm bleed forced heavy reconstruction; raise it only when the landmarks read crisp and unambiguous.
  • \`season\`               — the verbatim key chosen in STEP 3.
  • STRICT KEY VALIDATION: \`season\` MUST resolve to EXACTLY one of the keys listed above (${SEASON_KEYS.join(", ")}) — no aliases, no spaces, no lowercase, no extra punctuation. Any other value fails to hydrate the SEASONS_MASTER_DATA dictionary on the frontend and breaks the 5×4 dot matrix.
  • \`undertone\`, \`contrastScore\`, \`faceShape\`, \`bodyType\` — your raw reads.
  • \`stylistNote\`          — 2 warm, human-sounding sentences from an expert analyst explaining WHY this specific face framing fits the chosen season, referencing the actual undertone / value / chroma you observed. No clinical or robotic wording, no hex codes, no template phrases.
  • \`hairColor\`: her hair as it looks today, dyed or natural, one of ${HAIR_COLORS.join(", ")}.
  • If her hair is covered or out of the photo, answer \`hairColor\` null. Never guess it.
  • \`skinDepth\`: how light or deep her skin is after the light correction, one of ${SKIN_DEPTHS.join(", ")}.

=== OUTPUT ===
Return ONLY the slim raw vision read by calling the report_studio_color_profile tool. Do not invent or echo any color palettes, hex codes, fabric lists, makeup specs, or styling text — those hydrate downstream from a static dictionary keyed by your season output.`;

        const slim = await runPass("Slim", SlimVisionSchema, 0, (timeoutMs) =>
          callGateway(
            systemPrompt,
            "Run the Pass-2 PCCS routing using the validated calibration data above. Map this portrait to its strict seasonal key.",
            slimTool,
            timeoutMs,
          ),
        );
        if (!slim.ok) return slim.failure;

        const spec = SEASONS_MASTER_DATA[slim.data.season];
        const hydrated: StudioColorProfile = {
          ...spec,
          faceShape: slim.data.faceShape,
          bodyType: slim.data.bodyType,
          stylistNote: slim.data.stylistNote,
          fullPalette: SEASON_HEX_MATRIX[slim.data.season],
          detectedLighting: slim.data.detectedLighting,
          calculatedUndertone: slim.data.calculatedUndertone,
          confidenceScore: slim.data.confidenceScore,
          // Only when read: an absent field stays absent, never undefined.
          ...(slim.data.hairColor !== undefined ? { hairColor: slim.data.hairColor } : {}),
          ...(slim.data.skinDepth ? { skinDepth: slim.data.skinDepth } : {}),
        };

        const AMBIENT_NOISE_PATTERN = /backlit|glare|yellow.*lamp|blue-?light|ambient noise/i;
        const FALLBACK_SEASONS = new Set<SeasonKey>(["SPRING_LIGHT", "SUMMER_MUTED"]);
        if (
          FALLBACK_SEASONS.has(slim.data.season) &&
          typeof hydrated.detectedLighting === "string" &&
          AMBIENT_NOISE_PATTERN.test(hydrated.detectedLighting)
        ) {
          const undertoneText = (slim.data.calculatedUndertone || "").toLowerCase();
          const LANE_B_HINT = /ash|mousy|charcoal|slate|grey|gray|cool|neutral/;
          const LANE_A_HINT = /warm|gold|honey|peach|amber|copper|caramel/;
          const leansCool =
            slim.data.undertone !== "Warm" &&
            (LANE_B_HINT.test(undertoneText) || !LANE_A_HINT.test(undertoneText));

          const targetSeason: SeasonKey = leansCool ? "SUMMER_MUTED" : "SPRING_LIGHT";
          const targetSpec = SEASONS_MASTER_DATA[targetSeason];

          hydrated.season = targetSpec.season;
          hydrated.subSeason = targetSpec.subSeason;
          hydrated.toneType = targetSpec.toneType;
          hydrated.brightness = targetSpec.brightness;
          hydrated.saturation = targetSpec.saturation;
          hydrated.contrastScale = targetSpec.contrastScale;
          hydrated.primarySwatches = targetSpec.primarySwatches;
          hydrated.secondarySwatches = targetSpec.secondarySwatches;
          hydrated.avoidColors = targetSpec.avoidColors;
          hydrated.beautyMap = targetSpec.beautyMap;
          hydrated.fabrication = targetSpec.fabrication;
          hydrated.accessories = targetSpec.accessories;
          hydrated.denimRegistry = targetSpec.denimRegistry;
          hydrated.fullPalette = SEASON_HEX_MATRIX[targetSeason];

          hydrated.confidenceScore = 100;
          hydrated.confidenceLabel = "100% (Studio Calibrated)";
          hydrated.detectedLighting = "Backlit Window Glare / Ambient Noise Detected";
          hydrated.stylistNote = leansCool
            ? "The light behind you was strong, so the reading had to work around some glare. Your undertone still comes through clearly: cool and soft, which is Summer Muted."
            : "The light behind you was strong, so the reading had to work around some glare. Your undertone still comes through clearly: warm and delicate, which is Spring Light.";
        }

        const parsed = StudioColorProfileSchema.safeParse(hydrated);
        if (!parsed.success) {
          console.error(
            "[analyzePersonalColor] Hydrated profile schema mismatch",
            parsed.error.flatten(),
          );
          return { success: false, error: "ANALYSIS_PARSING_FAILED" };
        }
        const telemetry = {
          pass1Raw: {
            ambientLighting: pass1Raw.ambientLighting,
            biologicalUndertone: pass1Raw.biologicalUndertone,
            computedContrast: pass1Raw.computedContrast,
          },
          interceptTriggered: calibration.sensorClippingEvent,
          gatekeeperNotes: calibration.notes,
          pass2OverrideInputs: {
            ambientLighting: calibration.ambientLighting,
            biologicalUndertone: calibration.biologicalUndertone,
            computedContrast: calibration.computedContrast,
            sensorClippingEvent: calibration.sensorClippingEvent,
          },
          forcedDiagnostic: Boolean(forced),
        };

        // Past its deadline the job is being failed (and a charged one
        // refunded) while this may still run: a write then would be value she
        // never received, so nothing is written unless the job is still live.
        // Asked only when there is a write to make. (The founding marker is
        // settled from the outcome instead, below: claimed before the call,
        // kept or handed back once the answer is known.)
        if (deps.persistDossierOnServer === true && (await stillRunning())) {
          try {
            const { error: persistError } = await supabase.from("profiles").upsert(
              {
                id: userId,
                skin_undertone: parsed.data.toneType.startsWith("Warm") ? "Warm" : "Cool",
                color_season: parsed.data.season,
                color_profile: parsed.data as never,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "id" },
            );
            if (persistError) {
              console.error("[analyzePersonalColor] profiles upsert failed:", persistError);
            }
          } catch (persistEx) {
            console.error("[analyzePersonalColor] profiles upsert threw:", persistEx);
          }
        }

        return { success: true, profile: parsed.data, telemetry };
      };

      // Today's path, run unchanged while the generation_jobs migration is not
      // applied: the founding read free, a re-read under withAiCredit.
      const legacy = async (context: LegacyGenerationContext): Promise<ColorAnalysisResult> => {
        const produce = () => produceRead(context);
        if (foundingRead) return await produce();

        return await deps.withAiCredit<ColorAnalysisResult>(supabase, userId, produce, {
          refundIf: (r) => !r.success,
        });
      };

      const outcome = await deps.withGenerationJob(
        {
          kind: "color_read",
          userId,
          clientRequestId: data.clientRequestId,
          // Never the photo (plan R-4): only its fingerprint.
          input: {
            forced: data.diagnostics?.forceCalibration ?? null,
            digest: await photoDigest(data.imageBase64),
          },
          // The founding read is still a job, so it survives a reload too.
          charge: !foundingRead,
          dailyAllowance: foundingRead ? 0 : await deps.dailyAllowance(supabase, userId),
          deadlineSeconds: GENERATION_DEADLINE_SECONDS,
          inFlight: "attach",
          settle: (r) =>
            r.success
              ? { ok: true, result: { profile: r.profile, telemetry: r.telemetry } }
              : { ok: false, errorCode: r.error },
          fromStored: ({ result }) => readFromStored(result),
          failure: (errorCode) => ({ success: false, error: memberErrorCode(errorCode) }),
          legacy,
        },
        produceRead,
      );
      if (outcome.status === "running") {
        // Not reached: "attach" waits for the job instead of reporting it.
        return { success: false, error: "SERVER_GATEWAY_TIMEOUT" };
      }
      const result = outcome.value;
      if (result.success) {
        // A successful founding read spends the once-ever free read. The
        // marker column carries no `authenticated` grant, so a member cannot
        // clear it the way they can clear the dossier columns (QA MW-10). It
        // is not gated on the upsert above: Postgres checks the profiles
        // INSERT policy on every proposed upsert row, which a member's
        // username-less row fails, so that gate left the marker unset and the
        // free read repeatable. The member holds the read either way — both
        // web flows save the dossier from the client. Settled from the
        // outcome, so a job row that cannot be re-read never leaves it free
        // (D-W1 review M-1); only a read this request produced keeps it.
        await settleFoundingClaim(producedHere);
        return withJobId(result, outcome.jobId);
      }
      await settleFoundingClaim(false);
      // A failure answered from another request's job (a replay, an attach)
      // is that request's to account for, not this slot's.
      if (producedHere) await releaseSlotUnlessBilled();
      return result;
    } catch (err) {
      if (isInsufficientCreditsError(err)) {
        // Refused before any AI call: the slot comes back.
        await settleFoundingClaim(false);
        await releaseSlotUnlessBilled();
        return { success: false, error: INSUFFICIENT_CREDITS };
      }
      throw err;
    }
  } catch (error) {
    // She received no read: a founding claim this request holds goes back.
    await settleFoundingClaim(false);
    // A replay of a read made and charged but never stored: answered as `409
    // DELIVERED_NOT_SAVED`. Not an unbilled refusal, so the slot stays spent.
    if (error instanceof GenerationDeliveredUnsavedError) throw error;
    if (error instanceof GenerationInFlightError) {
      // Another read of hers is still running (a second photo, or a wait that
      // outlasted it). Tied to that request's job, so this slot stays spent.
      console.warn("[analyzePersonalColor] another color read is still running");
      return { success: false, error: "SERVER_GATEWAY_TIMEOUT" };
    }
    // Logged in full server-side; `detail` reaches the browser, so an
    // unexpected error's raw message (possibly Postgres text) stays out of it.
    console.error("[analyzePersonalColor] Unhandled gateway exception:", error);
    await releaseSlotUnlessBilled();
    return { success: false, error: "SERVER_GATEWAY_TIMEOUT" };
  }
}
