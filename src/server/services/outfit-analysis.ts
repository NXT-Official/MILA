import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aiChatCompletion } from "@/lib/ai.server";
import { assertTrustedStorageImageUrl } from "@/lib/trusted-image-url.server";
import { consumeRateLimit } from "@/lib/rate-limit.server";
import { withAiCredit } from "@/lib/credits.server";
import {
  GENERATION_DEADLINE_SECONDS,
  resolveDailyAllowance,
  withGenerationJob,
  withJobId,
  type GenerationJobDeps,
  type GenerationJobRunning,
  type GenerationWriteGuard,
} from "@/lib/generation-jobs.server";
import { normalizeMatchScore } from "@/lib/match-score";
import { captureServerException } from "@/lib/sentry.server";
import type { Json } from "@/integrations/supabase/types";
import { AiUnavailableError } from "@/server/http/api-errors";
import type { AnalyzeOutfitInputData } from "@/lib/analyze-outfit.functions";
import { MILA_VOICE } from "@/lib/mila-voice";

type MilaSupabaseClient = SupabaseClient<Database>;

export type OutfitAnalysis = {
  color_match: string;
  silhouette: string;
  overall_score: number | null;
  verdict: string;
};

const tool = {
  function: {
    name: "report_outfit_analysis",
    parameters: {
      type: "object",
      properties: {
        color_match: {
          type: "string",
          description: "1-2 sentence verdict on color harmony with the user's season.",
        },
        silhouette: {
          type: "string",
          description: "1-2 sentence verdict on how the silhouette flatters the user's body type.",
        },
        overall_score: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Overall match score 0-100.",
        },
        verdict: {
          type: "string",
          description:
            "2-4 sentences, candid but encouraging overall feedback with one concrete suggestion.",
        },
      },
      required: ["color_match", "silhouette", "overall_score", "verdict"],
      additionalProperties: false,
    },
  },
};

/** What the client is answered with: the read, plus the History row the
 * server saved it into (null when it did not, or the client did not ask) and
 * the job that carried it (absent on the legacy path). */
export type LensAnalysisResponse = OutfitAnalysis & {
  outfitId?: string | null;
  jobId?: string;
};

export type OutfitAnalysisDeps = {
  /** The provider chat call. Tests inject fakes. */
  ai?: typeof aiChatCompletion;
  /** The legacy credit wrapper, used only while the generation_jobs migration
   * is not applied (the job charges once at start otherwise). */
  withCredit?: typeof withAiCredit;
  /** The generation-job seams (store, availability, clock). */
  jobs?: GenerationJobDeps;
  /** The daily allowance the job's charge is taken against. */
  dailyAllowance?: (supabase: MilaSupabaseClient, userId: string) => Promise<number>;
  /** The service-role client the History row is written with. */
  admin?: () => Promise<MilaSupabaseClient>;
  /** The hourly cap. Tests inject a pass-through. */
  consumeRateLimit?: typeof consumeRateLimit;
  /** The job deadline in seconds. Tests shorten it; production uses the route maximum. */
  deadlineSeconds?: number;
};

const FAILURE_MESSAGE = "AI analysis failed.";

/** Length caps for the model's text fields (verdict is 2-4 sentences, the
 * others 1-2), so a runaway answer can't bloat the job row or History. */
const MAX_FIELD_CHARS = { color_match: 1000, silhouette: 1000, verdict: 2000 } as const;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Builds exactly the four fields from the model's output (no extra keys),
 * text trimmed and capped, the score coerced by the History rule. A missing or
 * empty TEXT field throws, so the job fails and refunds. An unusable score is
 * kept as null: the read is still delivered (and replays identically).
 */
function cleanAnalysis(raw: unknown): OutfitAnalysis {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const color_match = cleanText(r.color_match, MAX_FIELD_CHARS.color_match);
  const silhouette = cleanText(r.silhouette, MAX_FIELD_CHARS.silhouette);
  const verdict = cleanText(r.verdict, MAX_FIELD_CHARS.verdict);
  const overall_score = normalizeMatchScore(r.overall_score);
  if (!color_match || !silhouette || !verdict) {
    throw new AiUnavailableError(FAILURE_MESSAGE);
  }
  return { color_match, silhouette, overall_score, verdict };
}

function isStoredAnalysis(value: unknown): value is Record<string, unknown> & OutfitAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.color_match === "string" &&
    typeof v.silhouette === "string" &&
    typeof v.verdict === "string" &&
    (typeof v.overall_score === "number" || v.overall_score === null)
  );
}

async function defaultAdmin(): Promise<MilaSupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Scores one outfit photo against the caller's body type and color season.
 * **1 AI credit**, 15/hour. Shared verbatim by the web `analyzeOutfit` server
 * function and the mobile `POST /api/v1/analysis/outfit` route.
 *
 * Runs as a generation job (src/lib/generation-jobs.server.ts): the credit is
 * taken when the job starts, the read is stored before it is returned, a
 * repeated `clientRequestId` replays it without a second charge, and every
 * failure refunds once. With `saveToHistory` the server also inserts the
 * `outfits` row (service role) inside the job, so a paid read reaches History
 * even if the tab or app is gone. `inFlight: 'report'` answers
 * `{ status: 'running', jobId }` while another read is in flight. Until the
 * migration is applied this is exactly the old `withAiCredit` path: nothing is
 * saved here (`outfitId: null`) and the client writes as before.
 */
export function analyzeOutfitForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: AnalyzeOutfitInputData,
  options?: { inFlight?: "attach" },
  deps?: OutfitAnalysisDeps,
): Promise<LensAnalysisResponse>;
export function analyzeOutfitForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: AnalyzeOutfitInputData,
  options: { inFlight: "report" },
  deps?: OutfitAnalysisDeps,
): Promise<LensAnalysisResponse | GenerationJobRunning>;
export async function analyzeOutfitForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: AnalyzeOutfitInputData,
  options: { inFlight?: "attach" | "report" } = {},
  deps: OutfitAnalysisDeps = {},
): Promise<LensAnalysisResponse | GenerationJobRunning> {
  const ai = deps.ai ?? aiChatCompletion;
  const withCredit = deps.withCredit ?? withAiCredit;
  const dailyAllowanceFor = deps.dailyAllowance ?? resolveDailyAllowance;
  const adminClient = deps.admin ?? defaultAdmin;
  const rateLimit = deps.consumeRateLimit ?? consumeRateLimit;

  await rateLimit(`ai:analyzeOutfit:${userId}`, {
    limit: 15,
    windowSeconds: 3600,
  });
  // Validation that needs no AI runs before the job, so a refused request is
  // never charged.
  const imageUrl = assertTrustedStorageImageUrl(data.imageUrl);
  const saveToHistory = data.saveToHistory === true;

  const analyzeOnly = async (): Promise<OutfitAnalysis> => {
    const systemPrompt = `You are an expert fashion stylist and color analyst. You are evaluating an outfit for a user with a ${data.bodyType} body type and a ${data.colorSeason} color profile. Look at the attached image. Does the silhouette flatter their specific body type? Do the colors harmonize with their season? Be honest first, kind second — say what works and what doesn't, and why, in plain words. Always call the report_outfit_analysis tool with your findings.

${MILA_VOICE}`;

    const result = await ai(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this outfit for me." },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      tool,
      { supabase, userId },
    );
    if (!result.ok) throw new AiUnavailableError(FAILURE_MESSAGE);

    return cleanAnalysis(result.args);
  };

  // Lands the read in History. A failed write never fails the paid read: the
  // answer carries outfitId null and the client saves it itself.
  const saveOutfit = async (analysis: OutfitAnalysis): Promise<string | null> => {
    try {
      const admin = await adminClient();
      const { data: row, error } = await admin
        .from("outfits")
        .insert({
          user_id: userId,
          image_url: imageUrl,
          analysis_result: analysis as unknown as Json,
          match_score: normalizeMatchScore(analysis.overall_score),
        })
        .select("id")
        .single();
      if (error || !row) {
        console.error("[lens] the server couldn't save the analysis:", error?.message);
        captureServerException(error ?? new Error("outfits insert returned no row"));
        return null;
      }
      return row.id;
    } catch (err) {
      console.error("[lens] the server couldn't save the analysis:", err);
      captureServerException(err);
      return null;
    }
  };

  // src: src/lib/generation-jobs.server.ts (GenerationJobContext) · P2B-S0
  // The write is skipped once the job is past its deadline (the wrapper is
  // refunding it): a History row then would be value she was refunded for.
  // aiChatCompletion takes no abort signal, so the context signal is unused.
  const produce = async ({ stillRunning }: GenerationWriteGuard): Promise<LensAnalysisResponse> => {
    const analysis = await analyzeOnly();
    const outfitId = saveToHistory && (await stillRunning()) ? await saveOutfit(analysis) : null;
    return { ...analysis, outfitId };
  };

  const outcome = await withGenerationJob<LensAnalysisResponse>(
    {
      kind: "lens_analysis",
      userId,
      clientRequestId: data.clientRequestId,
      input: {
        imageUrl,
        bodyType: data.bodyType,
        colorSeason: data.colorSeason,
        saveToHistory,
      },
      charge: true,
      dailyAllowance: await dailyAllowanceFor(supabase, userId),
      deadlineSeconds: deps.deadlineSeconds ?? GENERATION_DEADLINE_SECONDS,
      inFlight: options.inFlight,
      settle: (value) => ({ ok: true, result: value as unknown as Json }),
      fromStored: ({ result }) => {
        if (!isStoredAnalysis(result)) throw new AiUnavailableError(FAILURE_MESSAGE);
        // cleanAnalysis is idempotent: what produce stored reads back unchanged.
        const outfitId = result.outfitId;
        return {
          ...cleanAnalysis(result),
          outfitId: typeof outfitId === "string" ? outfitId : null,
        };
      },
      failure: () => {
        throw new AiUnavailableError(FAILURE_MESSAGE);
      },
      legacy: async () => ({
        ...(await withCredit(supabase, userId, analyzeOnly)),
        outfitId: null,
      }),
    },
    produce,
    deps.jobs,
  );
  return outcome.status === "running" ? outcome : withJobId(outcome.value, outcome.jobId);
}
