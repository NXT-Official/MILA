import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/constants/query-keys";
import { useAuth } from "@/hooks/use-auth";
import type { StyleProfileRow } from "@/lib/style-profile/completion";
import type { Json } from "@/integrations/supabase/types";

export interface StyleProfileUpdatePayload {
  skin_undertone?: string | null;
  color_season?: string | null;
  color_profile?: Json | null;
  body_type?: string | null;
  face_shape?: string | null;
  hair_type?: string | null;
  beauty_preferences?: Json;
  default_location?: string | null;
}

export type StyleProfileUpdateResult = StyleProfileRow & {
  beauty_preferences: Json;
  default_location: string | null;
};

const RETURNING_COLUMNS =
  "skin_undertone,color_season,color_profile,body_type,face_shape,hair_type,beauty_preferences,default_location";

export function useUpdateStyleProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: StyleProfileUpdatePayload) => {
      if (!user) throw new Error("Not signed in.");
      const { data, error } = await supabase
        .from("profiles")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select(RETURNING_COLUMNS)
        .single();
      if (error) throw error;
      return data as StyleProfileUpdateResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(user?.id) });
    },
  });
}
