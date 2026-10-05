import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { climateForWeatherCode } from "@/constants/climate";
import { logAiSpend } from "@/lib/ai-spend.server";
import { aiChatCompletion } from "@/lib/ai.server";
import { withAiCredit, markLookImagePending, payForLookImage } from "@/lib/credits.server";
import {
  normalizeBeautyPreferences,
  formatBeautyPreferencesForPrompt,
} from "@/lib/beauty-preferences";
import {
  ImageProviderRateLimitError,
  generateOutfitImage,
  IMAGE_PROVIDER,
} from "@/lib/openrouter-image.server";
import { errorMessage } from "@/lib/utils";
import {
  buildDailyLookTool,
  buildInventoryReviewPrompt,
  buildInventoryReviewTool,
  buildOutfitPlanPrompt,
  computeMakeupEligibility,
  DailyLookSchema,
  HAIRSTYLE_TRENDS_2026,
  UNISEX_HAIRSTYLE_TRENDS_2026,
  hydrateShoppablePicks,
  AESTHETIC_STYLE_GUIDES,
  type DailyLook,
  type GenerateLookInputData,
  type ShoppablePick,
} from "@/lib/generate-outfit.functions";
import { deriveColorMetrics } from "@/lib/profile-color";
import { AESTHETIC_MOODS } from "@/constants/style-profile";
import {
  buildFallbackShortlist,
  formatInventoryForPrompt,
  loadLookInventory,
  needsColdWeatherOuterwear,
  pickWeatherBackfill,
  resolveShortlist,
  type LookInventoryItem,
} from "@/lib/look-products.functions";
import { AiUnavailableError, DomainValidationError } from "@/server/http/api-errors";

type MilaSupabaseClient = SupabaseClient<Database>;

/** Below this many shortlisted rows — when the inventory is clearly big
 * enough to support more — the review stage is re-asked once. Confirmed
 * live: a thin one-row shortlist left the plan stage with nothing to build
 * a full look from, and it composed a single-garment "look" instead. */
const REVIEW_MIN_SHORTLIST = 8;

/** The compose stages share the client's budget: the dashboard and the
 * mobile client both give up at 240s. The server aims to resolve by this
 * deadline so the member always gets a real answer (success, or the friendly
 * AI_UNAVAILABLE retry message) before the client's own timeout fires.
 * Confirmed live: unbounded provider calls let one stalled response burn the
 * whole budget, and a timed-out compose surfaced as a generic failure. */
const COMPOSE_DEADLINE_MS = 225_000;
/** Per-attempt budgets. Paired with one retry per stage, the worst case
 * (both attempts of both stages) still lands inside COMPOSE_DEADLINE_MS. */
const REVIEW_CALL_TIMEOUT_MS = 70_000;
const PLAN_CALL_TIMEOUT_MS = 85_000;
/** OpenRouter reasoning budgets: these calls otherwise spend ~10k reasoning
 * tokens to produce a ~1.5k answer (live probe), dominating latency and cost.
 * Bounded waits in the same probe still returned full, valid payloads. */
const REVIEW_REASONING_TOKENS = 1024;
const PLAN_REASONING_TOKENS = 4096;

export type LookImageResult = {
  imageDataUri: string | null;
  imageGenerationError?: string;
};

/**
 * Composes today's Daily Look (outfit + hair + makeup) and charges one AI
 * credit. Shared verbatim by the web `generateDailyLook` server function and
 * the mobile `POST /api/v1/look/generate` route — this is the entire body
 * that used to live inside `generateDailyLook`'s handler.
 *
 * The pipeline is three steps, all in this one request:
 *   1. loadLookInventory — the whole eligible shop catalog for this client.
 *   2. Inventory review (deepseek v4.1 flash) — checks every row against the
 *      style profile + occasion and reports a shortlist by row index.
 *   3. Outfit plan (deepseek v4.1 flash) — composes the look from the
 *      shortlist, naming real pieces; shoppable_picks = the outfit's pieces.
 *
 * The shop shelf carries ONLY the outfit's own pieces — the rows the
 * style-sheet visual wears, plus the deterministic weather backfill below.
 * "More like this" additions (source "similar") were removed on purpose:
 * category-only matching surfaced pieces the generated image never shows,
 * which read as a random shop dump beside the look. The client's next call
 * renders the plan's visual with muse-image.
 */
export async function generateLookForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: GenerateLookInputData,
): Promise<DailyLook> {
  return withAiCredit(supabase, userId, async () => {
    const { data: profileRow } = await supabase
      .from("profiles")
      .select(
        "beauty_preferences,gender,makeup_preference,hair_length,skin_depth,height_cm,weight_kg,color_profile,color_season,skin_undertone",
      )
      .eq("id", userId)
      .maybeSingle();

    const { selectedAesthetic } = deriveColorMetrics(profileRow);
    const aestheticName = selectedAesthetic
      ? AESTHETIC_MOODS.find((m) => m.id === selectedAesthetic)?.name
      : null;
    const aestheticGuide = selectedAesthetic ? AESTHETIC_STYLE_GUIDES[selectedAesthetic] : null;

    const beautyPreferences = normalizeBeautyPreferences(profileRow?.beauty_preferences);
    const makeupEnabled = computeMakeupEligibility({
      gender: profileRow?.gender,
      makeup_preference: profileRow?.makeup_preference,
    });
    const hairLengthValue = profileRow?.hair_length?.trim() || null;
    const genderValue =
      profileRow?.gender && profileRow.gender !== "Prefer not to say" ? profileRow.gender : null;
    const skinDepthValue = profileRow?.skin_depth?.trim() || null;
    const heightCm = profileRow?.height_cm ?? null;
    const weightKg = profileRow?.weight_kg ?? null;

    let tempF = data.tempF;
    let tempC = data.tempC;
    let condition = data.condition;
    let forecastRetrievedAt: string | null = null;
    if ((tempF == null || !condition) && data.lat != null && data.lon != null) {
      try {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${data.lat}&longitude=${data.lon}&current=temperature_2m,weather_code,wind_speed_10m`,
        );
        const j = (await r.json()) as {
          current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
        };
        const c = Math.round(j?.current?.temperature_2m ?? 20);
        const code = j?.current?.weather_code ?? 2;
        const wind = Math.round(j?.current?.wind_speed_10m ?? 0);
        tempC = tempC ?? c;
        tempF = tempF ?? Math.round((c * 9) / 5 + 32);
        condition ??= climateForWeatherCode(code, wind).condition;
        forecastRetrievedAt = new Date().toISOString();
      } catch (err) {
        console.warn("Open-Meteo fetch failed; falling back to label only.", err);
      }
    }

    const tempLine =
      tempF != null
        ? `${tempF}°F (${tempC ?? Math.round(((tempF - 32) * 5) / 9)}°C)`
        : data.weather;
    const conditionLine = condition ?? "Mixed";
    const locationLine = data.location ?? "the user's location";

    const beautyPrefsLine = formatBeautyPreferencesForPrompt(beautyPreferences);

    const faceShapeValue = data.faceShape?.trim() || null;
    const hairTypeValue = data.hairType?.trim() || null;
    const colorSeasonValue = data.colorSeason?.trim();
    if (!colorSeasonValue) throw new DomainValidationError("Color season missing from profile.");
    if (!data.bodyType?.trim()) {
      throw new DomainValidationError(
        "Body type missing from profile. Complete your Studio dossier first.",
      );
    }

    const failure = "Mila couldn't compose a look this time. Please try again.";

    // Step 1 — the whole eligible catalog: real, in-stock, non-broken rows
    // that ship to the client's region and fit their gender. An ambiguous
    // profile (unknown/Non-binary/Prefer-not-to-say) still gets one Male or
    // Female fallbackGenderDirection, decided once here before the catalog
    // even loads — Unisex items are always eligible regardless, but a
    // category with no Unisex option (Bottoms, Shoes) now surfaces real
    // candidates from a single consistent direction instead of either an
    // empty slot or a menswear/womenswear mix. Because this runs before the
    // review/plan AI calls and pickSimilarAdditions below, all three stay
    // gender-consistent for free — nothing downstream needs to know this
    // happened. Never invented by the model.
    const productGenderFilter =
      genderValue === "Male" || genderValue === "Female" ? genderValue : undefined;
    const fallbackGenderDirection: "Male" | "Female" | null = productGenderFilter
      ? null
      : Math.random() < 0.5
        ? "Male"
        : "Female";
    const inventory = await loadLookInventory(supabase, {
      colorSeason: colorSeasonValue,
      bodyType: data.bodyType,
      tempF,
      region: data.region,
      gender: productGenderFilter,
      fallbackDirection: fallbackGenderDirection ?? undefined,
    });

    const profileLines = [
      genderValue
        ? `- Gender presentation: ${genderValue} (AUTHORITATIVE — garment types, cuts, and silhouettes must suit this presentation; for Non-binary favor gender-neutral/androgynous silhouettes; never default to a gendered assumption otherwise)`
        : null,
      `- Body type: ${data.bodyType}`,
      heightCm != null || weightKg != null
        ? `- Build: ${[heightCm != null ? `${heightCm}cm` : null, weightKg != null ? `${weightKg}kg` : null].filter(Boolean).join(", ")} (AUTHORITATIVE for proportion — derive concrete silhouette math from this exact height, e.g. rise height, hem/break length, jacket length vs. torso, layering scale, waist placement; taller framing can carry longer coats and lower rise, shorter framing needs higher rise, cropped hems, and vertical lines to elongate; never restate these numbers back in the output, only the resulting silhouette choices)`
        : null,
      `- 16-season color profile: ${colorSeasonValue} (AUTHORITATIVE — every color reference in outfit/hair/makeup MUST be drawn from this exact season; do NOT substitute a different season name)`,
      data.skinUndertone ? `- Skin undertone: ${data.skinUndertone}` : null,
      skinDepthValue
        ? `- Skin depth: ${skinDepthValue} (combine with undertone above when judging color contrast, saturation, and finish choices)`
        : null,
      faceShapeValue
        ? `- Face shape: ${faceShapeValue} (use this exact face-shape name in the hair rationale)`
        : null,
      hairTypeValue
        ? `- Hair type: ${hairTypeValue} (use this exact hair-type name in the hair rationale)`
        : null,
      hairLengthValue ? `- Current hair length: ${hairLengthValue}` : null,
      `- Beauty preferences: ${beautyPrefsLine}`,
      aestheticName && aestheticGuide
        ? `- Personal style identity: ${aestheticName} — ${aestheticGuide} (this is the client's standing aesthetic signature; blend it with today's occasion vibe below rather than defaulting to a generic take on that occasion)`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const weatherBlock = `LOCAL WEATHER (authoritative — do not override):
- Location: ${locationLine}
- Temperature: ${tempLine}
- Condition: ${conditionLine}
- Verbal summary: ${data.weather}`;

    const agendaBlock =
      data.agenda || data.dressCode || data.indoorOutdoor
        ? `TODAY'S AGENDA (when present, this is more specific than the vibe above and takes priority for occasion-appropriateness — do not contradict it):
${data.agenda ? `- Plan: ${data.agenda}` : ""}
${data.dressCode ? `- Dress code: ${data.dressCode}` : ""}
${data.indoorOutdoor ? `- Setting: ${data.indoorOutdoor}` : ""}`
        : "";

    // Step 2 — inventory review: one deepseek pass over the WHOLE numbered
    // catalog, answering with row indexes only (buildInventoryReviewTool).
    // resolveShortlist maps them back to real rows and drops anything that
    // isn't a live row from the same list, so the plan stage below can only
    // ever choose pieces that actually exist in the shop.
    let shortlistProducts: LookInventoryItem[] = [];
    const composeStartedAt = Date.now();
    const remainingComposeMs = () => COMPOSE_DEADLINE_MS - (Date.now() - composeStartedAt);
    /** Clamp a per-attempt budget to what's left, with a small floor so a
     * late attempt still gets a real chance rather than a 3-second spasm. */
    const composeCallTimeout = (preferredMs: number) =>
      Math.max(20_000, Math.min(preferredMs, remainingComposeMs()));
    const canRetryComposeCall = () => remainingComposeMs() > 40_000;
    if (inventory.length > 0) {
      const reviewPrompt = buildInventoryReviewPrompt({
        profileLines,
        weatherBlock,
        agendaBlock,
        vibe: data.vibe,
        inventoryCount: inventory.length,
        inventoryBlock: formatInventoryForPrompt(inventory, {
          colorSeason: colorSeasonValue,
          bodyType: data.bodyType,
        }),
      });

      const reviewMessages = [
        { role: "system", content: reviewPrompt },
        { role: "user", content: "Check the full inventory and report the shortlist." },
      ];
      const reviewTool = buildInventoryReviewTool(inventory.length - 1);
      const reviewOptions = {
        timeoutMs: composeCallTimeout(REVIEW_CALL_TIMEOUT_MS),
        reasoningMaxTokens: REVIEW_REASONING_TOKENS,
      };
      let reviewed = await aiChatCompletion(
        reviewMessages,
        reviewTool,
        { supabase, userId },
        reviewOptions,
      );
      if (!reviewed.ok && canRetryComposeCall()) {
        // One retry: confirmed live, a stalled provider stream that killed the
        // whole generation on attempt one routinely succeeds on a fresh call —
        // and the deadline above guarantees the pair still lands in budget.
        console.warn(
          `[generateLookForUser] review call failed (status=${reviewed.status}) — retrying with ${Math.round(remainingComposeMs() / 1000)}s left`,
        );
        reviewed = await aiChatCompletion(
          reviewMessages,
          reviewTool,
          { supabase, userId },
          {
            timeoutMs: composeCallTimeout(REVIEW_CALL_TIMEOUT_MS),
            reasoningMaxTokens: REVIEW_REASONING_TOKENS,
          },
        );
      }
      if (!reviewed.ok) {
        // Both review attempts failed: degrade to the deterministic shortlist
        // rather than failing the whole generation — the plan stage can still
        // compose a real look from catalogue rows, with the same attire gate
        // the review would have applied.
        console.warn(
          `[generateLookForUser] review unavailable (status=${reviewed.status}) — using the deterministic shortlist`,
        );
        shortlistProducts = buildFallbackShortlist(inventory, {
          vibe: data.vibe,
          colorSeason: colorSeasonValue,
          bodyType: data.bodyType,
          tempF,
        });
      } else {
        shortlistProducts = resolveShortlist(
          (reviewed.args as Record<string, unknown> | null)?.shortlist,
          inventory,
        );

        // Shortlist floor with one recheck: the reviewer occasionally comes back
        // with a near-empty shortlist for a strict occasion (confirmed live: a
        // Business Attire run returned ONE row, and the plan stage then composed
        // a one-garment "look" — the plan can only choose from what this stage
        // returns). When the inventory clearly supports a full look, re-ask once
        // rather than shipping a thin one; the better shortlist wins.
        if (
          shortlistProducts.length < REVIEW_MIN_SHORTLIST &&
          inventory.length >= REVIEW_MIN_SHORTLIST * 2 &&
          remainingComposeMs() > 90_000
        ) {
          const recheck = await aiChatCompletion(
            [
              { role: "system", content: reviewPrompt },
              { role: "user", content: "Check the full inventory and report the shortlist." },
              {
                role: "user",
                content: `That shortlist carried only ${shortlistProducts.length} row(s) — far too thin to build a full head-to-toe look. Re-check the ENTIRE inventory and report a full shortlist covering every wearable slot the occasion allows (3–4 tops, 3–4 bottoms/dresses, 2–3 shoes, outerwear only if the weather calls for it, bags, jewelry, accessories), up to two dozen rows, best-first per category.`,
              },
            ],
            reviewTool,
            { supabase, userId },
            {
              timeoutMs: composeCallTimeout(REVIEW_CALL_TIMEOUT_MS),
              reasoningMaxTokens: REVIEW_REASONING_TOKENS,
            },
          );
          if (recheck.ok) {
            const second = resolveShortlist(
              (recheck.args as Record<string, unknown> | null)?.shortlist,
              inventory,
            );
            if (second.length > shortlistProducts.length) shortlistProducts = second;
          } else {
            console.warn(
              `[generateLookForUser] shortlist recheck failed after a thin review (${shortlistProducts.length} rows kept, status=${recheck.status})`,
            );
          }
        }
      }

      if (shortlistProducts.length === 0) {
        // Diagnosable: an empty shortlist silently degrades the look to
        // "no shoppable picks", so leave a trace of the review that caused it.
        console.warn(
          `[generateLookForUser] inventory review returned an empty shortlist (${inventory.length} rows reviewed)`,
        );
      }
    }

    const hairLengthRule = hairLengthValue
      ? hairLengthValue === "Bald/Shaved"
        ? " The client is bald/shaved — do not prescribe any hairstyle; keep 'style' and 'execution_tip' focused on scalp care or a grooming note instead."
        : ` The client's current hair length is ${hairLengthValue} — recommend ONLY styles achievable at this length. Never assume added length, extensions, or a different length than what's stated.`
      : "";

    const trendList =
      genderValue === "Male" || genderValue === "Female"
        ? HAIRSTYLE_TRENDS_2026[genderValue]
        : UNISEX_HAIRSTYLE_TRENDS_2026;
    const trendLine = ` Draw from named 2026 trending cuts where they fit — e.g. ${trendList.join(", ")} — adapted to the length/type/face-shape constraints below; don't force a fit if none of these suit the client's stated length or type.`;

    const hairRule =
      (faceShapeValue && hairTypeValue
        ? `- HAIR (CROSS-REFERENCE REQUIRED): the 'style' MUST be a specific silhouette engineered for BOTH the user's hair type (${hairTypeValue}) AND face shape (${faceShapeValue}). Reference the face shape "${faceShapeValue}" by name inside the rationale. Name the silhouette concretely (parting, length, volume placement, finish). Explain in one clause how it balances the ${faceShapeValue} face shape. NEVER prescribe a silhouette that fights the hair type. The 'execution_tip' must name a specific product class, tool size, or technique appropriate to ${hairTypeValue} hair.`
        : hairTypeValue
          ? `- HAIR: prescribe a concrete silhouette appropriate to ${hairTypeValue} hair (parting, length, volume placement, finish). The 'execution_tip' must name a specific product class, tool size, or technique appropriate to ${hairTypeValue} hair.`
          : faceShapeValue
            ? `- HAIR: prescribe a concrete silhouette that flatters a ${faceShapeValue} face shape; reference it by name in the rationale. Name the silhouette concretely and give one execution tip.`
            : `- HAIR: prescribe a concrete silhouette (parting, length, volume placement, finish) plus one execution tip.`) +
      trendLine +
      hairLengthRule;

    // Step 3 — outfit plan: the shortlist, with full descriptions and attire
    // registers, is the only material the outfit may be composed from. Only
    // shortlist ids are in the tool enum (hallucination guard), and the full
    // rows are what hydrateShoppablePicks joins back to.
    const shortlistBlock =
      shortlistProducts.length > 0
        ? shortlistProducts
            .map((p) =>
              [
                `id="${p.id}"`,
                p.category,
                p.title,
                `${p.price} ${p.currency}`,
                p.attire.length > 0 ? p.attire.join("/") : null,
                p.description,
              ]
                .filter((part): part is string => part != null && part !== "")
                .join(" | "),
            )
            .join("\n")
        : "(none available right now — compose the outfit without inventory pieces and omit shoppable_picks entirely)";

    const systemPrompt = buildOutfitPlanPrompt({
      profileLines,
      weatherBlock,
      agendaBlock,
      vibe: data.vibe,
      colorSeason: colorSeasonValue,
      bodyType: data.bodyType,
      skinDepth: skinDepthValue,
      skinUndertone: data.skinUndertone,
      faceShape: faceShapeValue,
      makeupEnabled,
      beautyPrefsLine,
      hairRule,
      shortlistBlock,
    });

    const shortlistIds = shortlistProducts.map((p) => p.id);
    const planMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Compose today's complete look." },
    ];
    const planTool = buildDailyLookTool(makeupEnabled, shortlistIds);
    let composed = await aiChatCompletion(
      planMessages,
      planTool,
      { supabase, userId },
      {
        timeoutMs: composeCallTimeout(PLAN_CALL_TIMEOUT_MS),
        reasoningMaxTokens: PLAN_REASONING_TOKENS,
      },
    );
    if (!composed.ok && canRetryComposeCall()) {
      console.warn(
        `[generateLookForUser] plan call failed (status=${composed.status}) — retrying with ${Math.round(remainingComposeMs() / 1000)}s left`,
      );
      composed = await aiChatCompletion(
        planMessages,
        planTool,
        { supabase, userId },
        {
          timeoutMs: composeCallTimeout(PLAN_CALL_TIMEOUT_MS),
          reasoningMaxTokens: PLAN_REASONING_TOKENS,
        },
      );
    }
    if (!composed.ok) throw new AiUnavailableError(failure);

    // Hydrate the model's product_id/rationale picks into full, real product
    // rows — price/link/title the client sees always come from here, never
    // from model text (see hydrateShoppablePicks for the drop-unknown-id logic).
    const rawArgs = composed.args as Record<string, unknown>;
    const hydratedPicks = hydrateShoppablePicks(rawArgs.shoppable_picks, shortlistProducts);

    // Climate backstop: CLIMATE_RULES asks deepseek (in prompt text) to
    // include outerwear below COLD_WEATHER_F, but prompt compliance isn't
    // guaranteed. Deterministically add the best-scoring available Outerwear
    // row when the plan came back without one — no extra DB read, no AI call.
    const weatherBackfill = pickWeatherBackfill(hydratedPicks, inventory, {
      tempF,
      colorSeason: colorSeasonValue,
      bodyType: data.bodyType,
    });
    if (!weatherBackfill && needsColdWeatherOuterwear(hydratedPicks, tempF)) {
      // Diagnosable: nothing to backfill with, so this look ships without
      // outerwear despite the cold — leave a trace of why.
      console.warn(
        `[generateLookForUser] cold-weather outfit missing Outerwear and none available in inventory (tempF=${tempF})`,
      );
    }
    const picksWithWeatherBackfill: ShoppablePick[] = weatherBackfill
      ? [
          ...hydratedPicks,
          {
            ...weatherBackfill.product,
            rationale: weatherBackfill.rationale,
            source: "planned" as const,
          },
        ]
      : hydratedPicks;

    // The shop shelf: ONLY the outfit's own pieces — exactly what the
    // generated visual wears (plan + weather backfill). Do NOT re-add
    // same-category "similar" rows here: category-only matching surfaces
    // pieces the image never shows (sportswear beside a tailored look),
    // which reads as a random shop dump instead of the look itself.
    const shelfPicks: ShoppablePick[] = picksWithWeatherBackfill;

    // Force makeup to null when disabled regardless of what the model
    // returned — the tool schema already omits it, but this is the hard
    // server-side boundary, not a suggestion to the model.
    const argsWithMakeup = {
      ...rawArgs,
      makeup: makeupEnabled ? (rawArgs.makeup ?? null) : null,
      shoppable_picks: shelfPicks,
      forecastRetrievedAt,
      fallback_gender_direction: fallbackGenderDirection,
    };
    const look = DailyLookSchema.safeParse(argsWithMakeup);
    if (!look.success) {
      // Confirmed live: this threw the same generic message for both a real
      // provider failure and a valid-but-schema-rejected model output (e.g.
      // a field exceeding its max length), with zero way to tell them apart
      // after the fact. Log the actual zod issues so a future rejection is
      // diagnosable instead of a silent "couldn't compose a look."
      console.error(
        "[generateLookForUser] DailyLookSchema rejected model output",
        JSON.stringify(look.error.issues),
      );
      throw new AiUnavailableError(failure);
    }
    // The credit charged above covers this look's first visual, rendered by the
    // separate renderLookImageForUser call the client makes next.
    await markLookImagePending(userId);
    return look.data;
  });
}

/**
 * Renders (or claims the free first render of) a Daily Look's visual. Shared
 * verbatim by the web `regenerateOutfitImage` server function and the mobile
 * `POST /api/v1/look/image` route.
 *
 * A failed render is not an exception here — it is a first-class partial
 * result (`imageDataUri: null` + `imageGenerationError`), matching what
 * `payForLookImage` needs to decide whether to refund/re-mark the free slot.
 */
export async function renderLookImageForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: DailyLook,
): Promise<LookImageResult> {
  return payForLookImage(supabase, userId, async () => {
    try {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("gender,skin_depth,height_cm")
        .eq("id", userId)
        .maybeSingle();
      const {
        imageUrl,
        model: imageModel,
        costUsd,
        promptTokens,
        completionTokens,
        totalTokens,
      } = await generateOutfitImage(data, {
        gender: profileRow?.gender,
        skinDepth: profileRow?.skin_depth,
        heightCm: profileRow?.height_cm,
        fallbackGenderDirection: data.fallback_gender_direction ?? null,
      });
      await logAiSpend(supabase, userId, {
        provider: IMAGE_PROVIDER,
        // The model that actually rendered it — staff can switch the image
        // model from the admin console, so a constant here would misattribute
        // spend from the moment it changes.
        model: imageModel,
        costUsd,
        promptTokens,
        completionTokens,
        totalTokens,
      });
      return { imageDataUri: imageUrl };
    } catch (error) {
      console.error("[generateOutfitImage] failed:", errorMessage(error, "Unknown error"));
      return {
        imageDataUri: null,
        // Surface the specific reason (site-wide quota vs. provider rate
        // limit) rather than a one-size-fits-all message — both messages
        // from openrouter-image.server.ts are already user-appropriate.
        imageGenerationError:
          error instanceof ImageProviderRateLimitError
            ? error.message
            : "The outfit was created, but its visual could not be generated.",
      };
    }
  });
}
