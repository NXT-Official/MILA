import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DailyLookSchema, computeMakeupEligibility } from "./generate-outfit.functions";
import { sanitizePicksForSave } from "./saved-picks";
import { uploadGeneratedOutfitImage, deleteOutfitImage } from "./outfit-image-storage.server";

const SaveOutfitInput = DailyLookSchema.extend({
  // Optional now: every generation is saved automatically, and a look whose
  // visual has not (yet) rendered — or never will, without photo consent —
  // still lands in history, text and picks only.
  imageDataUri: z.string().min(1).nullable().optional(),
  weather: z.string().min(1).max(160),
  vibe: z.string().min(1).max(64),
  // Planned outfit pieces + the "similar" shelf options beside them (capped
  // at MAX_SIMILAR_TOTAL = 8 in look-products.functions.ts); 40 leaves room
  // for a maximal planned look without ever rejecting a save.
  productIds: z.array(z.string().uuid()).max(40).optional(),
  previewMode: z.enum(["inspiration", "photo_edit", "style_sheet"]).optional(),
});

export const saveOutfitToHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = SaveOutfitInput.safeParse(input);
    if (!parsed.success) {
      console.error("[saveOutfitToHistory] invalid input", parsed.error.flatten());
      throw new Error("The look could not be saved. Please try again.");
    }
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    const {
      imageDataUri,
      weather,
      vibe,
      outfit,
      hair,
      makeup,
      vibe_alignment_score,
      forecastRetrievedAt,
      productIds,
      shoppable_picks,
      previewMode,
    } = data;

    // Snapshot the eligibility inputs active right now, server-side — never
    // trusted from the client — so a later profile change never rewrites
    // what this saved look actually showed.
    const { data: profileRow } = await context.supabase
      .from("profiles")
      .select("gender,makeup_preference,hair_length,photo_consent_at")
      .eq("id", context.userId)
      .maybeSingle();
    const makeupEnabled = computeMakeupEligibility({
      gender: profileRow?.gender,
      makeup_preference: profileRow?.makeup_preference,
    });

    // A missing visual is a valid save: the compose pipeline auto-saves before
    // the style sheet exists (and never renders one without photo consent), so
    // the row's image is optional — upload only when there is one.
    const uploaded = imageDataUri
      ? await uploadGeneratedOutfitImage({
          supabase: context.supabase,
          userId: context.userId,
          imageDataUri,
        })
      : null;

    const { data: row, error } = await context.supabase
      .from("outfits")
      .insert({
        user_id: context.userId,
        image_url: uploaded?.publicUrl ?? null,
        analysis_result: {
          type: "daily_look",
          weather,
          vibe,
          vibe_alignment_score,
          outfit,
          hair,
          makeup,
          forecastRetrievedAt: forecastRetrievedAt ?? null,
          productIds: productIds ?? [],
          // The suggested items themselves, with their links — what History
          // re-renders under the look. Sanitized server-side: the row shape is
          // client-supplied, and the links are rendered as hrefs.
          shoppable_picks: sanitizePicksForSave(shoppable_picks),
          previewMode: previewMode ?? "inspiration",
          gender: profileRow?.gender ?? null,
          makeupEnabled,
          hairLength: profileRow?.hair_length ?? null,
          photoConsentVersion: profileRow?.photo_consent_at ?? null,
        },
        match_score: null,
      })
      .select("id, image_url, created_at")
      .single();

    if (error) {
      if (uploaded) await deleteOutfitImage(context.supabase, uploaded.storagePath);
      console.error("[saveOutfitToHistory] insert failed:", error.message);
      throw new Error("The look could not be saved. Please try again.");
    }

    return row;
  });
