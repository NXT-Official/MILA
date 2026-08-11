import { UNDERTONES, SEASONS, BODIES, FACE_SHAPES, HAIR_TYPES } from "@/constants/style-profile";
import type { DashboardProfile } from "@/lib/queries/profile";

export interface StyleProfileRow {
  skin_undertone: string | null;
  color_season: string | null;
  body_type: string | null;
  face_shape: string | null;
  hair_type: string | null;
  color_profile: unknown;
}

export function toStyleProfileRow(
  profile:
    | (Omit<StyleProfileRow, "color_season"> & { color_season_base: string | null })
    | null
    | undefined,
): StyleProfileRow | null {
  if (!profile) return null;
  return {
    skin_undertone: profile.skin_undertone,
    color_season: profile.color_season_base,
    body_type: profile.body_type,
    face_shape: profile.face_shape,
    hair_type: profile.hair_type,
    color_profile: profile.color_profile,
  };
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

export interface DossierCompletion {
  filled: number;
  total: number;
  percent: number;
  missing: string[];
}

/**
 * Progress across every signal Mila styles from — the six the onboarding gate
 * requires plus the two optional ones it lets you skip. Members only reach the
 * dashboard with the required six in hand, so in practice this measures how
 * much of the optional depth is still missing.
 */
export function dossierCompletion(profile: DashboardProfile | null | undefined): DossierCompletion {
  const beautyPrefs = profile?.beauty_preferences;
  const signals: Array<[label: string, filled: boolean]> = [
    ["Color season", (SEASONS as readonly string[]).includes(profile?.color_season_base ?? "")],
    ["Skin undertone", (UNDERTONES as readonly string[]).includes(profile?.skin_undertone ?? "")],
    ["Body silhouette", (BODIES as readonly string[]).includes(profile?.body_type ?? "")],
    ["Face shape", (FACE_SHAPES as readonly string[]).includes(profile?.face_shape ?? "")],
    ["Hair texture", (HAIR_TYPES as readonly string[]).includes(profile?.hair_type ?? "")],
    ["Color analysis", isNonEmptyColorProfile(profile?.color_profile)],
    ["Beauty preferences", Array.isArray(beautyPrefs) && beautyPrefs.length > 0],
    ["Home city", !!profile?.default_location?.trim()],
  ];

  const missing = signals.filter(([, filled]) => !filled).map(([label]) => label);
  const filled = signals.length - missing.length;
  return {
    filled,
    total: signals.length,
    percent: Math.round((filled / signals.length) * 100),
    missing,
  };
}
