import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/constants/query-keys";
import { deriveColorMetrics } from "@/lib/profile-color";
import type { Json } from "@/integrations/supabase/types";

export type DashboardProfile = {
  body_type: string | null;
  color_season: string | null;
  color_season_base: string | null;
  skin_undertone: string | null;
  full_name: string | null;
  face_shape: string | null;
  hair_type: string | null;
  beauty_preferences: Json | null;
  color_profile: Json | null;
  default_location: string | null;
};

const EMPTY_PROFILE: DashboardProfile = {
  body_type: null,
  color_season: null,
  color_season_base: null,
  skin_undertone: null,
  full_name: null,
  face_shape: null,
  hair_type: null,
  beauty_preferences: null,
  color_profile: null,
  default_location: null,
};

function normalizeFirstWord(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const first = v.trim().split(/\s+/)[0];
  return first || null;
}

function buildDashboardProfile(
  data: {
    body_type: string | null;
    color_season: string | null;
    skin_undertone: string | null;
    full_name: string | null;
    color_profile: Json | null;
    face_shape: string | null;
    hair_type: string | null;
    beauty_preferences: Json | null;
    default_location: string | null;
  } | null,
): DashboardProfile {
  if (!data) return EMPTY_PROFILE;

  const metrics = deriveColorMetrics(data);
  const json = data.color_profile as {
    subSeason?: string;
    season?: string;
    faceShape?: string;
    hairType?: string;
  } | null;

  const faceShape = data.face_shape ?? normalizeFirstWord(json?.faceShape) ?? null;
  const hairType =
    data.hair_type ??
    (typeof json?.hairType === "string" && json.hairType.trim() ? json.hairType : null);

  return {
    body_type: data.body_type ?? null,
    color_season: json?.subSeason ?? metrics.season ?? null,
    color_season_base: data.color_season ?? null,
    skin_undertone: metrics.undertone,
    full_name: data.full_name ?? null,
    face_shape: faceShape,
    hair_type: hairType,
    beauty_preferences: data.beauty_preferences ?? null,
    color_profile: data.color_profile ?? null,
    default_location: data.default_location ?? null,
  };
}

export function profileQueryOptions(userId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.profile(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "body_type,color_season,skin_undertone,full_name,color_profile,face_shape,hair_type,beauty_preferences,default_location",
        )
        .eq("id", userId as string)
        .maybeSingle();
      if (error) throw error;
      return buildDashboardProfile(data);
    },
    staleTime: 5 * 60_000,
  });
}
