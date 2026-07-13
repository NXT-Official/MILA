import { SeasonId } from "./types";

export function migrateLegacySeason(legacySeason: string): SeasonId {
  const normalized = legacySeason.toLowerCase().trim();

  switch (normalized) {
    case "spring":
      return "true_spring";
    case "summer":
      return "true_summer";
    case "autumn":
      return "true_autumn";
    case "winter":
      return "true_winter";
    default:
      return normalized as SeasonId;
  }
}
