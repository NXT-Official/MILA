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

  faceShape: "Diamond Geometry" | "Oval Frame" | "Round Frame" | "Square Frame" | "Heart Frame" | "Long Frame";

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

  /** Optional calibration provenance — surfaced as a chip on the dossier header. */
  calibrationSource?: "AI Vision" | "Studio Calibrated";

  confidenceScore?: number;

  /** Optional pre-formatted confidence label (e.g. "100% (Studio Calibrated)"). */
  confidenceLabel?: string;

}


/**
 * SEASON_HEX_MATRIX
 *
 * Curated, professionally calibrated 20-hex PCCS color matrix per 12-sub-type
 * season key (matches the SEASON_KEYS used by analyzePersonalColor). Drives
 * the 5×4 dossier grid card directly — no redundant repeats.
 */
export const SEASON_HEX_MATRIX: Record<string, string[]> = {
  SPRING_LIGHT: ["#FFB3A7","#FFA07A","#FFC0CB","#FFD1A9","#FAECB4","#FFF3CD","#FFFDD0","#E2F0D9","#D4EDDA","#A3E4D7","#E0F7FA","#AED5FA","#E8DAEF","#FADBD8","#FCF3CF","#EAFAF1","#FFF8DC","#FFE4E1","#F9EBEA","#FDEDEC"],
  SPRING_TRUE: ["#FFB347","#FFA500","#FF8C42","#FF7F50","#FF6347","#FFD166","#FFC107","#FFEB3B","#F4C430","#9ACD32","#7FFF00","#00FA9A","#40E0D0","#48D1CC","#87CEEB","#FF8FA3","#FFB6C1","#FFDAB9","#FAD7A0","#F39C12"],
  SPRING_BRIGHT: ["#FF3B30","#FF9500","#FFCC00","#4CD964","#00F5D4","#5AC8FA","#5856D6","#FF2D55","#007AFF","#34AADC","#FFD700","#FF4500","#00FF7F","#00FFFF","#FF00FF","#9932CC","#FF1493","#ADFF2F","#00E5FF","#76FF03"],
  SPRING_WARM: ["#E67E22","#F39C12","#F1C40F","#2ECC71","#1ABC9C","#D35400","#FF8C00","#FFA500","#C5A059","#9ACD32","#3CB371","#20B2AA","#CD853F","#D2691E","#B8860B","#F5DEB3","#DEB887","#E9967A","#FF7F50","#FF6347"],
  SUMMER_LIGHT: ["#FADBD8","#EBDEF0","#E8F8F5","#EBF5FB","#E8E8E8","#D7BDE2","#A9CCE3","#A2D9CE","#ABEBC6","#F9E79F","#F5CBA7","#EDBB99","#EAECEE","#D5D8DC","#B0C4DE","#E6F2F7","#F0F4F8","#FDF2F4","#F4EEF8","#EAF2F8"],
  SUMMER_TRUE: ["#B0C4DE","#A2B9D9","#8DA9D6","#7395B6","#5B7DA6","#6A89CC","#A29BFE","#B19CD9","#D8BFD8","#C9A7D8","#E8B4D8","#F4A6C1","#F5B7B1","#E59ABF","#A8CBE2","#9FB8AD","#7FB7BE","#5D8AA8","#778899","#C8BFE7"],
  SUMMER_MUTED: ["#95A5A6","#BDC3C7","#A6B4A6","#8F9E8B","#708090","#778899","#8A9A86","#9CAEA9","#B2BEB5","#B0C4DE","#A1CAF1","#87A96B","#C2B280","#BCB88A","#D3B3B3","#C8A2C8","#B57EDC","#A89F91","#8C92AC","#967BB6"],
  SUMMER_COOL: ["#2E4053","#34495E","#5D6D7E","#85929E","#AEB6BF","#1F618D","#2980B9","#5499C7","#7FB3D5","#A9CCE3","#48C9B0","#76D7C4","#A3E4D7","#BB8FCE","#D2B4DE","#F1948A","#EC7063","#7B7D7D","#4682B4","#B0E0E6"],
  AUTUMN_SOFT: ["#9A7D0A","#B7950B","#D4AC0D","#F4D03F","#196F3D","#229954","#52BE80","#A9DFBF","#BA4A00","#DC7633","#E59866","#F0B27A","#A04000","#CA6F1E","#E67E22","#F39C12","#EDBB99","#F6DDCC","#C2B280","#8A9A86"],
  AUTUMN_TRUE: ["#B8651A","#A0522D","#8B4513","#CD853F","#D2691E","#DAA520","#B8860B","#9B7B3C","#6B8E23","#556B2F","#8FBC8F","#2E8B57","#BC8F8F","#7B3F00","#5C4033","#C04000","#E2725B","#996515","#704214","#A0431B"],
  AUTUMN_DEEP: ["#4A235A","#154360","#0E6251","#145A32","#7D6608","#78281F","#1B2631","#2C3E50","#512E5F","#1A5276","#117864","#196F3D","#9A7D0A","#784212","#6E2C00","#7B241C","#1C2833","#212F3D","#3E2723","#4E342E"],
  AUTUMN_WARM: ["#D35400","#E67E22","#CA6F1E","#A04000","#873600","#6E2C00","#BA4A00","#DC7633","#E59866","#D4AC0D","#B7950B","#9A7D0A","#7D6608","#145A32","#196F3D","#229954","#27AE60","#52BE80","#8B4513","#A0522D"],
  WINTER_DEEP: ["#1B2631","#2C3E50","#17202A","#212F3D","#4A235A","#512E5F","#0E4D92","#002FA7","#0B3C5D","#1D2731","#050505","#1C1C1C","#2D2D2D","#3D3D3D","#4A0E17","#641E16","#78281F","#0B5345","#0E6251","#301934"],
  WINTER_CLEAR: ["#FF0000","#FF1493","#00FF00","#00FFFF","#0000FF","#8B00FF","#FF00FF","#FFFFFF","#000000","#39FF14","#00E5FF","#76FF03","#FF007F","#1F1F1F","#4D4D4D","#E6E6E6","#1A1A1A","#FF0055","#00FFCC","#330066"],
  WINTER_TRUE: ["#000080","#191970","#000033","#1C39BB","#0F52BA","#B22222","#8B0000","#4B0082","#800080","#660066","#9400D3","#008B8B","#005F5F","#00008B","#FFFFFF","#000000","#C71585","#DC143C","#6A5ACD","#2F4F4F"],
  WINTER_COOL: ["#1F3A52","#2E5B82","#417CA3","#69A0C3","#003366","#4B0082","#483D8B","#4A154B","#6B114D","#8A1C5A","#B11B56","#800020","#004B49","#005C53","#042940","#000000","#1C1C1C","#7F8C8D","#FFFFFF","#E0F7FA"],
};

/** Resolve the most appropriate 20-hex matrix for a given season + subSeason label. */
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



/**
 * MASTER_SEASONAL_PALETTES
 *
 * Definitive Apgujeong-atelier reference dictionary for all 12 PCCS seasonal
 * sub-types. Each entry holds the 20-hex master palette plus salon makeup &
 * styling specs. Used as the single source of truth for both the AI system
 * prompt and any client-side fallback rendering.
 */
export interface SeasonalPaletteSpec {
  key: string;
  season: Season;
  label: string;
  characteristics: string;
  palette: string[]; // exactly 20 hex values
  makeup: string;
  styling: string;
}

export const MASTER_SEASONAL_PALETTES: Record<string, SeasonalPaletteSpec> = {
  "spring-light": {
    key: "spring-light",
    season: "Spring",
    label: "Spring Light",
    characteristics: "High Lightness, Soft Warmth, Delicate Clarity",
    palette: SEASON_HEX_MATRIX.SPRING_LIGHT,
    makeup: "Clear peach gloss, soft salmon pink, luminous ivory base.",
    styling: "Chiffon, fine cotton knits, polished 14k yellow gold, seed pearls.",
  },
  "spring-bright": {
    key: "spring-bright",
    season: "Spring",
    label: "Spring Bright (Clear Spring)",
    characteristics: "High Saturation, Striking Clarity, Vivid Warmth",
    palette: SEASON_HEX_MATRIX.SPRING_BRIGHT,
    makeup: "Bright coral or warm red lip, vibrant peach blush, glass-skin radiant base.",
    styling: "Smooth patent leather, high-shine silks, highly polished bright yellow gold.",
  },
  "spring-true": {
    key: "spring-true",
    season: "Spring",
    label: "Spring True",
    characteristics: "Pure Warm Spring Vitality, Medium Clarity, Sunlit Brightness",
    palette: SEASON_HEX_MATRIX.SPRING_TRUE,
    makeup: "Warm coral lip, sunlit peach blush, golden luminous base.",
    styling: "Crisp poplin, soft pebbled leather, polished yellow gold, sunlit amber accents.",
  },
  "spring-warm": {
    key: "spring-warm",
    season: "Spring",
    label: "Spring Warm",
    characteristics: "Pure Warmth, Medium-High Saturation, Sunny Vitality",
    palette: SEASON_HEX_MATRIX.SPRING_WARM,
    makeup: "Rich terracotta or warm apricot lip, golden bronzed base, warm brown mascara.",
    styling: "Pebble-grain tan leather, warm wooden accents, solid unpolished brass, heavy yellow gold.",
  },
  "summer-light": {
    key: "summer-light",
    season: "Summer",
    label: "Summer Light",
    characteristics: "High Lightness, Icy Coolness, Milky Pastels",
    palette: SEASON_HEX_MATRIX.SUMMER_LIGHT,
    makeup: "Soft cool pink gloss, dusty rose blush, pale porcelain matte base.",
    styling: "Sheer organza, washed linen, brushed white gold, satin-finish sterling silver.",
  },
  "summer-muted": {
    key: "summer-muted",
    season: "Summer",
    label: "Summer Muted (Soft Summer)",
    characteristics: "Low Saturation, Ashy/Hazy Tones, Soft Coolness",
    palette: SEASON_HEX_MATRIX.SUMMER_MUTED,
    makeup: "Muted mauve or dusty berry lip, cool taupe contour, velvet satin base.",
    styling: "Soft suede, heathered cashmere, matte platinum, antique vintage silver.",
  },
  "summer-true": {
    key: "summer-true",
    season: "Summer",
    label: "Summer True",
    characteristics: "Pure Cool Summer Clarity, Medium Lightness, Rose & Periwinkle Base",
    palette: SEASON_HEX_MATRIX.SUMMER_TRUE,
    makeup: "Cool rose lip, soft orchid blush, porcelain demi-matte base.",
    styling: "Fine silk crepe, light merino wool, brushed white gold, freshwater pearls.",
  },
  "summer-cool": {
    key: "summer-cool",
    season: "Summer",
    label: "Summer Cool",
    characteristics: "Pure Coolness, Medium Clarity, Slate/Oceanic Tones",
    palette: SEASON_HEX_MATRIX.SUMMER_COOL,
    makeup: "Classic berry or cool orchid lip, soft lavender highlight, crisp demi-matte porcelain base.",
    styling: "Smooth silk jersey, fine merino wool, polished white gold, high-luster sterling silver.",
  },
  "autumn-soft": {
    key: "autumn-soft",
    season: "Autumn",
    label: "Autumn Soft",
    characteristics: "Low Saturation, Earthy Warmth, Hazy Olive/Khaki",
    palette: SEASON_HEX_MATRIX.AUTUMN_SOFT,
    makeup: "Warm nude lip, toasted cinnamon blush, soft velvet olive-undertone base.",
    styling: "Soft brushed cords, washed utility canvas, matte brass, brushed yellow gold.",
  },
  "autumn-true": {
    key: "autumn-true",
    season: "Autumn",
    label: "Autumn True",
    characteristics: "Pure Earthy Warmth, Medium Saturation, Forest & Spice Baseline",
    palette: SEASON_HEX_MATRIX.AUTUMN_TRUE,
    makeup: "Burnished brick lip, warm sienna blush, satin golden base.",
    styling: "Heavy cotton twill, oiled saddle leather, antique brass, carved tigers eye.",
  },
  "autumn-deep": {
    key: "autumn-deep",
    season: "Autumn",
    label: "Autumn Deep (Dark Autumn)",
    characteristics: "Low Lightness, Rich Dark Contrast, Heavy Warmth",
    palette: SEASON_HEX_MATRIX.AUTUMN_DEEP,
    makeup: "Deep brick red or espresso brown lip, warm amber bronzer, rich full-coverage gold base.",
    styling: "Heavy alligator leather, structured wool tweeds, antique bronze, heavy 18k hammered gold.",
  },
  "autumn-warm": {
    key: "autumn-warm",
    season: "Autumn",
    label: "Autumn Warm",
    characteristics: "Pure Earthy Warmth, Spicy Saturation, Forest Shades",
    palette: SEASON_HEX_MATRIX.AUTUMN_WARM,
    makeup: "Burnt orange, pumpkin spice or rich ochre lip, heavy warm ginger blush.",
    styling: "Thick shearling, heavy cable knits, raw copper, natural wood grain elements.",
  },
  "winter-deep": {
    key: "winter-deep",
    season: "Winter",
    label: "Winter Deep (Dark Winter)",
    characteristics: "Low Lightness, Extreme Dark Contrast, Midnight Coolness",
    palette: SEASON_HEX_MATRIX.WINTER_DEEP,
    makeup: "Deep plum, midnight blackberry or dark cherry lip, flawless high-contrast porcelain base.",
    styling: "Heavy velvet, thick structured brocade, polished gunmetal, dark obsidian silver.",
  },
  "winter-clear": {
    key: "winter-clear",
    season: "Winter",
    label: "Winter Clear",
    characteristics: "High Saturation, Neon-Crisp Clarity, Striking Contrast",
    palette: SEASON_HEX_MATRIX.WINTER_CLEAR,
    makeup: "Electric fuchsia or high-shine crimson red lip, crisp diamond highlighter, ultra-bright clear base.",
    styling: "Glossy latex, stiff structural neoprene, polished brilliant diamonds, mirror-finish white gold.",
  },
  "winter-true": {
    key: "winter-true",
    season: "Winter",
    label: "Winter True",
    characteristics: "Pure Cool Jewel Tones, High Contrast, Royal Saturation",
    palette: SEASON_HEX_MATRIX.WINTER_TRUE,
    makeup: "True ruby red lip, cool berry blush, snowy porcelain base.",
    styling: "Heavy silk satin, polished platinum, fine grain leather, brilliant diamond cut.",
  },
  "winter-cool": {
    key: "winter-cool",
    season: "Winter",
    label: "Winter Cool",
    characteristics: "Pure Icy Coolness, High Contrast, Royal/Jewel Tones",
    palette: SEASON_HEX_MATRIX.WINTER_COOL,
    makeup: "Deep royal ruby red or magenta lip, icy pink blush, snowy white velvet base.",
    styling: "Liquid silk satin, premium heavy grain leather, brilliant platinum, solid silver chunks.",
  },
};



export const MOOD_COLLECT_DEFAULT: DetailedColorProfile = {

  season: "Spring",

  subSeason: "Spring Soft / PCCS Light & Soft",

  toneType: "Warm Tone (Yellow Base)",

  brightness: "High Lightness",

  saturation: "Low-Mid Saturation",

  contrastScale: "Low Contrast",

  faceShape: "Diamond Geometry",

  bodyType: "Inverted Triangle",

  primarySwatches: [

    { hex: "#FFB3A7", name: "Warm Peach Blush" },

    { hex: "#FFD1A9", name: "Soft Apricot" },

    { hex: "#FFF3CD", name: "Buttermilk Chiffon" },

    { hex: "#D4EDDA", name: "Light Pistachio Mint" }

  ],

  secondarySwatches: [

    { hex: "#FDF5E6", name: "Warm Cream Ivory" },

    { hex: "#FFC0CB", name: "Light Coral Pink" },

    { hex: "#E0F7FA", name: "Soft Aquamarine" },

    { hex: "#E8DAEF", name: "Gentle Lavender-Pink" }

  ],

  accentSwatches: [

    { hex: "#FFA07A", name: "Light Salmon Coral" },

    { hex: "#AED5FA", name: "Warm Sky Blue" },

    { hex: "#F2A172", name: "Soft Salmon Apricot" }

  ],

  avoidColors: [

    "Pure High-Contrast Black (Swallows delicate features and drops heavy shadow lines)",

    "Stark Bleached White (Creates excessive facial contrast shadows)",

    "Strong / Vivid Primary Tones (Completely overpowers the soft expression matrix)"

  ],

  beautyMap: {

    hair: "Light milk chocolate brown, honey blonde highlights, or bright warm amber tones. Avoid ashy or jet black colors.",

    lip: "Clear peach gloss, warm coral tints, or soft salmon pink.",

    base: "Clear, luminous ivory with a warm peach or golden undertone (Dewy finish)."

  },

  fabrication: [

    "Chiffon & Organza",

    "Fine Knit Cotton",

    "Lightweight Linen"

  ],

  accessories: [

    "Polished 14k Yellow Gold",

    "Warm Rose Gold",

    "Delicate Seed Pearls"

  ],

  denimRegistry: [

    "Soft Bleached Blue Denim",

    "Pure Dark Gray Denim"

  ],

  stylistNote: "Studio Diagnostic: Your canvas thrives on high lightness paired with delicate, low-to-medium saturation. Warm milk-pastels instantly clear away surface shadows and lift the jaw parameters effortlessly, maintaining a natural, lit-from-within glow."

  ,

  fullPalette: SEASON_HEX_MATRIX.SPRING_LIGHT

};
