import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { uploadProfilePhoto, deleteProfilePhoto } from "./profile-photo-storage.server";

const Input = z.object({ imageDataUri: z.string().min(1) });

/**
 * Consented profile photo storage — separate from the ephemeral photo sent
 * to analyzePersonalColor. Only called when the user explicitly opts in;
 * replaces (and cleans up) any previously stored photo.
 */
export const saveConsentedProfilePhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("profiles")
      .select("profile_photo_path")
      .eq("id", context.userId)
      .maybeSingle();

    const { storagePath } = await uploadProfilePhoto({
      supabase: context.supabase,
      userId: context.userId,
      imageDataUri: data.imageDataUri,
    });

    const { error } = await context.supabase
      .from("profiles")
      .update({ profile_photo_path: storagePath, photo_consent_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) {
      await deleteProfilePhoto(context.supabase, storagePath);
      console.error("[saveConsentedProfilePhoto] profile update failed:", error.message);
      throw new Error("The photo could not be saved. Please try again.");
    }

    if (existing?.profile_photo_path) {
      await deleteProfilePhoto(context.supabase, existing.profile_photo_path);
    }

    return { storagePath };
  });

export const deleteMyProfilePhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: existing } = await context.supabase
      .from("profiles")
      .select("profile_photo_path")
      .eq("id", context.userId)
      .maybeSingle();

    const { error } = await context.supabase
      .from("profiles")
      .update({ profile_photo_path: null, photo_consent_at: null })
      .eq("id", context.userId);
    if (error) {
      console.error("[deleteMyProfilePhoto] profile update failed:", error.message);
      throw new Error("The photo could not be removed. Please try again.");
    }

    if (existing?.profile_photo_path) {
      await deleteProfilePhoto(context.supabase, existing.profile_photo_path);
    }
  });
