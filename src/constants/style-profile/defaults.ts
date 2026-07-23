import type { DetailedColorProfile } from "./types";
import { SEASON_HEX_MATRIX } from "./data";

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
    { hex: "#D4EDDA", name: "Light Pistachio Mint" },
  ],
  secondarySwatches: [
    { hex: "#FDF5E6", name: "Warm Cream Ivory" },
    { hex: "#FFC0CB", name: "Light Coral Pink" },
    { hex: "#E0F7FA", name: "Soft Aquamarine" },
    { hex: "#E8DAEF", name: "Gentle Lavender-Pink" },
  ],
  accentSwatches: [
    { hex: "#FFA07A", name: "Light Salmon Coral" },
    { hex: "#AED5FA", name: "Warm Sky Blue" },
    { hex: "#F2A172", name: "Soft Salmon Apricot" },
  ],
  avoidColors: [
    "Pure High-Contrast Black (Swallows delicate features and drops heavy shadow lines)",
    "Stark Bleached White (Creates excessive facial contrast shadows)",
    "Strong / Vivid Primary Tones (Completely overpowers the palette's soft, delicate feel)",
  ],
  beautyMap: {
    hair: "Light milk chocolate brown, honey blonde highlights, or bright warm amber tones. Avoid ashy or jet black colors.",
    lip: "Clear peach gloss, warm coral tints, or soft salmon pink.",
    base: "Clear, luminous ivory with a warm peach or golden undertone (Dewy finish).",
  },
  fabrication: ["Chiffon & Organza", "Fine Knit Cotton", "Lightweight Linen"],
  accessories: ["Polished 14k Yellow Gold", "Warm Rose Gold", "Delicate Seed Pearls"],
  denimRegistry: ["Soft Bleached Blue Denim", "Pure Dark Gray Denim"],
  stylistNote:
    "Studio Diagnostic: Your canvas thrives on high lightness paired with delicate, low-to-medium saturation. Warm milk-pastels soften shadows and brighten your whole face, keeping that natural, lit-from-within glow.",
  fullPalette: SEASON_HEX_MATRIX.SPRING_LIGHT,
};
