import { UNDERTONES, SEASONS, BODIES, FACE_SHAPES, HAIR_TYPES } from "@/constants/style-profile";

export interface StyleProfileRow {
  skin_undertone: string | null;
  color_season: string | null;
  body_type: string | null;
  face_shape: string | null;
  hair_type: string | null;
  color_profile: unknown;
}

export function isNonEmptyColorProfile(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return "season" in obj || "primarySwatches" in obj;
}

export function isStyleProfileComplete(profile: StyleProfileRow | null | undefined): boolean {
  if (!profile) return false;
  return (
    (UNDERTONES as readonly string[]).includes(profile.skin_undertone ?? "") &&
    (SEASONS as readonly string[]).includes(profile.color_season ?? "") &&
    (BODIES as readonly string[]).includes(profile.body_type ?? "") &&
    (FACE_SHAPES as readonly string[]).includes(profile.face_shape ?? "") &&
    (HAIR_TYPES as readonly string[]).includes(profile.hair_type ?? "") &&
    isNonEmptyColorProfile(profile.color_profile)
  );
}
