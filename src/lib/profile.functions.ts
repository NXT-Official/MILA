import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { FACE_SHAPES, HAIR_TYPES } from "@/constants/style-profile";

const HolisticInput = z.object({
  face_shape: z.enum(FACE_SHAPES).nullable().optional(),
  hair_type: z.enum(HAIR_TYPES).nullable().optional(),
  beauty_preferences: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
});

export const updateHolisticProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => HolisticInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, unknown> = { id: userId, updated_at: new Date().toISOString() };
    if (data.face_shape !== undefined) patch.face_shape = data.face_shape;
    if (data.hair_type !== undefined) patch.hair_type = data.hair_type;
    if (data.beauty_preferences !== undefined) patch.beauty_preferences = data.beauty_preferences;
    const { error } = await supabase.from("profiles").upsert(patch as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id,full_name,body_type,color_season,skin_undertone,face_shape,hair_type,beauty_preferences,color_profile",
      )
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });
