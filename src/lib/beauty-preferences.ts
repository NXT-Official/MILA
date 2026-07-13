import { z } from "zod";

/**
 * Canonical application representation of `profiles.beauty_preferences`.
 * The DB column is JSONB defaulting to `[]` and every current writer
 * (onboarding, style-profile editor) saves a plain string array — this is
 * the one shape the rest of the app should use.
 */
export const BeautyPreferencesSchema = z.array(z.string().trim().min(1)).default([]);
export type BeautyPreferences = z.infer<typeof BeautyPreferencesSchema>;

function legacyKeyToLabel(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!spaced) return "";
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Normalizes whatever is actually stored in `profiles.beauty_preferences`
 * into `string[]`. The column is array-shaped by convention, but this
 * tolerates the legacy object shapes the DB comment allows for
 * (`{ selected: [...] }` and boolean-flag maps) without ever throwing —
 * malformed JSONB should degrade to "no preferences," not crash generation.
 */
export function normalizeBeautyPreferences(value: unknown): string[] {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.selected)) {
      return normalizeBeautyPreferences(record.selected);
    }
    return [
      ...new Set(
        Object.entries(record)
          .filter(([, enabled]) => enabled === true)
          .map(([key]) => legacyKeyToLabel(key))
          .filter(Boolean),
      ),
    ];
  }

  return [];
}

/** Readable, prompt-safe text — never JSON, never `[object Object]`. */
export function formatBeautyPreferencesForPrompt(preferences: string[]): string {
  return preferences.length > 0
    ? preferences.join(", ")
    : "No specific beauty finish preferences — recommend a finish that suits the palette, occasion, and weather.";
}
