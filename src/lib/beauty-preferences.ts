import { z } from "zod";

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

export function formatBeautyPreferencesForPrompt(preferences: string[]): string {
  return preferences.length > 0
    ? preferences.join(", ")
    : "No specific beauty finish preferences — recommend a finish that suits the palette, occasion, and weather.";
}
