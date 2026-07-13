export type DimensionValue = "Light" | "Light-to-Medium" | "Medium" | "Medium-to-Deep" | "Deep";
export type ContrastValue = "Low" | "Low-Medium" | "Medium" | "Medium-High" | "High" | "Very-High";
export type UndertoneValue = "Warm" | "Warm-Neutral" | "Cool-Neutral" | "Cool";
export type ChromaValue = "Soft" | "Bright";

export type SeasonId =
  | "light_spring"
  | "warm_spring"
  | "true_spring"
  | "bright_spring"
  | "light_summer"
  | "cool_summer"
  | "true_summer"
  | "soft_summer"
  | "soft_autumn"
  | "warm_autumn"
  | "true_autumn"
  | "deep_autumn"
  | "bright_winter"
  | "cool_winter"
  | "true_winter"
  | "deep_winter";

export interface ColorDimensions {
  value: DimensionValue;
  contrast: ContrastValue;
  undertone: UndertoneValue;
  chroma: ChromaValue;
}

export interface SeasonProfile {
  id: SeasonId;
  name: string;
  family: "Spring" | "Summer" | "Autumn" | "Winter";
  dimensions: ColorDimensions;
  sisterSeasonId: SeasonId;
  bestColorsDescription: string[];
  avoidColorsDescription: string[];
}
