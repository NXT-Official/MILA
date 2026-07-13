export type Season = "Spring" | "Summer" | "Autumn" | "Winter";
export type BodyType = "Hourglass" | "Rectangle" | "Pear" | "Inverted Triangle" | "Apple";
export type Swatch = { hex: string; name: string };

export interface DetailedColorProfile {
  season: Season;
  subSeason: string;
  toneType: "Warm Tone (Yellow Base)" | "Cool Tone (Blue Base)";
  brightness: "High Lightness" | "Medium Lightness" | "Low Lightness";
  saturation: "Low-Mid Saturation" | "High Saturation";
  contrastScale: "Low Contrast" | "Medium Contrast" | "High Contrast";
  faceShape:
    | "Diamond Geometry"
    | "Oval Frame"
    | "Round Frame"
    | "Square Frame"
    | "Heart Frame"
    | "Long Frame";
  bodyType: BodyType;
  primarySwatches: Swatch[];
  secondarySwatches: Swatch[];
  accentSwatches: Swatch[];
  avoidColors: string[];
  beautyMap: {
    hair: string;
    lip: string;
    base: string;
  };
  fabrication: string[];
  accessories: string[];
  denimRegistry: string[];
  stylistNote: string;
  fullPalette?: string[];
  calibrationSource?: "AI Vision" | "Studio Calibrated";
  confidenceScore?: number;
  confidenceLabel?: string;
}

export type StaticSeasonSpec = Pick<
  DetailedColorProfile,
  | "season"
  | "subSeason"
  | "toneType"
  | "brightness"
  | "saturation"
  | "contrastScale"
  | "primarySwatches"
  | "secondarySwatches"
  | "avoidColors"
  | "beautyMap"
  | "fabrication"
  | "accessories"
  | "denimRegistry"
>;

export interface SeasonalPaletteSpec {
  key: string;
  season: Season;
  label: string;
  characteristics: string;
  palette: string[];
  makeup: string;
  styling: string;
}

export type StudioTelemetry = {
  pass1Raw: { ambientLighting: string; biologicalUndertone: string; computedContrast: string };
  interceptTriggered: boolean;
  gatekeeperNotes: string[];
  pass2OverrideInputs: {
    ambientLighting: string;
    biologicalUndertone: string;
    computedContrast: string;
    sensorClippingEvent: boolean;
  };
  forcedDiagnostic: boolean;
  source?: "live" | "stress-test" | "manual";
};

export type MatrixOption = { value: string; title: string; description: string };
export type Tone = "Cool" | "Warm" | "Neutral";
