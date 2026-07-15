import { type StudioColorProfile } from "@/lib/analyzePersonalColor.functions";
import {
  Season,
  MOOD_COLLECT_DEFAULT,
  type DetailedColorProfile as StudioDossier,
} from "@/constants/style-profile";
import {
  matrixForSubSeason,
  seasonTone,
  seasonBrightness,
  seasonSaturation,
} from "@/lib/style-profile";

export function studioToDossier(p: StudioColorProfile, prev?: StudioDossier): StudioDossier {
  const season = p.season as Season;
  return {
    season,
    subSeason: p.subSeason,
    toneType: p.toneType ?? seasonTone(season),
    brightness: p.brightness ?? prev?.brightness ?? seasonBrightness(season),
    saturation: p.saturation ?? prev?.saturation ?? seasonSaturation(season),
    contrastScale: p.contrastScale ?? "Medium Contrast",
    faceShape: p.faceShape ?? "Oval Frame",
    bodyType: p.bodyType ?? prev?.bodyType ?? MOOD_COLLECT_DEFAULT.bodyType,
    primarySwatches: p.primarySwatches,
    secondarySwatches: p.secondarySwatches,
    accentSwatches: prev?.accentSwatches ?? MOOD_COLLECT_DEFAULT.accentSwatches,
    avoidColors: p.avoidColors,
    beautyMap: {
      hair: p.beautyMap?.hair ?? MOOD_COLLECT_DEFAULT.beautyMap.hair,
      lip: p.beautyMap?.lip ?? MOOD_COLLECT_DEFAULT.beautyMap.lip,
      base: p.beautyMap?.base ?? MOOD_COLLECT_DEFAULT.beautyMap.base,
    },
    fabrication: p.fabrication,
    accessories: p.accessories,
    denimRegistry: p.denimRegistry,
    stylistNote: p.stylistNote,
    fullPalette: (p as any).fullPalette ?? matrixForSubSeason(season, p.subSeason),
    calibrationSource:
      p.detectedLighting === "Manual Studio Calibration" ? "Studio Calibrated" : "AI Vision",
    confidenceScore: typeof p.confidenceScore === "number" ? p.confidenceScore : undefined,
    confidenceLabel:
      typeof (p as any).confidenceLabel === "string" ? (p as any).confidenceLabel : undefined,
  };
}

export function normalizeStoredProfile(raw: any): StudioDossier | null {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw.primarySwatches) && Array.isArray(raw.fabrication) && raw.stylistNote) {
    return studioToDossier(raw as StudioColorProfile);
  }
  if (Array.isArray(raw.primarySwatches) && raw.beautyMap) return raw as StudioDossier;
  return null;
}
