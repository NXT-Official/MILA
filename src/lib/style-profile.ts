import type { Season, DetailedColorProfile } from "@/constants/style-profile";
import { SEASON_HEX_MATRIX } from "@/constants/style-profile";

export function matrixForSubSeason(season: Season, subSeason: string): string[] {
  const s = (subSeason || "").toLowerCase();
  if (season === "Spring") {
    if (s.includes("bright") || s.includes("clear")) return SEASON_HEX_MATRIX.SPRING_BRIGHT;
    if (s.includes("true")) return SEASON_HEX_MATRIX.SPRING_TRUE;
    if (s.includes("warm")) return SEASON_HEX_MATRIX.SPRING_WARM;
    return SEASON_HEX_MATRIX.SPRING_LIGHT;
  }
  if (season === "Summer") {
    if (s.includes("muted") || s.includes("soft")) return SEASON_HEX_MATRIX.SUMMER_MUTED;
    if (s.includes("true")) return SEASON_HEX_MATRIX.SUMMER_TRUE;
    if (s.includes("cool")) return SEASON_HEX_MATRIX.SUMMER_COOL;
    return SEASON_HEX_MATRIX.SUMMER_LIGHT;
  }
  if (season === "Autumn") {
    if (s.includes("deep") || s.includes("dark")) return SEASON_HEX_MATRIX.AUTUMN_DEEP;
    if (s.includes("true")) return SEASON_HEX_MATRIX.AUTUMN_TRUE;
    if (s.includes("warm")) return SEASON_HEX_MATRIX.AUTUMN_WARM;
    return SEASON_HEX_MATRIX.AUTUMN_SOFT;
  }
  if (s.includes("deep") || s.includes("dark")) return SEASON_HEX_MATRIX.WINTER_DEEP;
  if (s.includes("bright") || s.includes("clear")) return SEASON_HEX_MATRIX.WINTER_CLEAR;
  if (s.includes("true")) return SEASON_HEX_MATRIX.WINTER_TRUE;
  return SEASON_HEX_MATRIX.WINTER_COOL;
}

export function seasonTone(s: Season): DetailedColorProfile["toneType"] {
  return (["Spring", "Autumn"] as Season[]).includes(s)
    ? "Warm Tone (Yellow Base)"
    : "Cool Tone (Blue Base)";
}
export function seasonBrightness(s: Season): DetailedColorProfile["brightness"] {
  if (s === "Spring" || s === "Summer") return "High Lightness";
  if (s === "Winter") return "Medium Lightness";
  return "Low Lightness";
}
export function seasonSaturation(s: Season): DetailedColorProfile["saturation"] {
  return s === "Winter" ? "High Saturation" : "Low-Mid Saturation";
}

export function splitBeauty(b: string, fallback: string): string {
  const idx = b.indexOf(":");
  return idx >= 0 ? b.slice(idx + 1).trim() : b || fallback;
}
