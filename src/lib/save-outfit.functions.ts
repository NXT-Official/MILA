import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DailyLookSchema, computeMakeupEligibility } from "./generate-outfit.functions";
import { uploadGeneratedOutfitImage, deleteOutfitImage } from "./outfit-image-storage.server";

const SaveOutfitInput = DailyLookSchema.extend({
  imageDataUri: z.string().min(1),
  weather: z.string().min(1).max(160),
  vibe: z.string().min(1).max(64),
  productIds: z.array(z.string().uuid()).max(20).optional(),
  previewMode: z.enum(["inspiration", "photo_edit"]).optional(),
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

    const { publicUrl, storagePath } = await uploadGeneratedOutfitImage({
      supabase: context.supabase,
      userId: context.userId,
      imageDataUri,
    });

    const { data: row, error } = await context.supabase
      .from("outfits")
      .insert({
        user_id: context.userId,
        image_url: publicUrl,
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
      await deleteOutfitImage(context.supabase, storagePath);
      console.error("[saveOutfitToHistory] insert failed:", error.message);
      throw new Error("The look could not be saved. Please try again.");
    }

    return row;
  });
