import type { SeasonalPaletteSpec } from "./types";
import { SEASON_HEX_MATRIX } from "./data";

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
    styling:
      "Pebble-grain tan leather, warm wooden accents, solid unpolished brass, heavy yellow gold.",
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
    makeup:
      "Classic berry or cool orchid lip, soft lavender highlight, crisp demi-matte porcelain base.",
    styling:
      "Smooth silk jersey, fine merino wool, polished white gold, high-luster sterling silver.",
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
    styling: "Heavy cotton twill, oiled saddle leather, antique brass, carved tiger's eye.",
  },
  "autumn-deep": {
    key: "autumn-deep",
    season: "Autumn",
    label: "Autumn Deep (Dark Autumn)",
    characteristics: "Low Lightness, Rich Dark Contrast, Heavy Warmth",
    palette: SEASON_HEX_MATRIX.AUTUMN_DEEP,
    makeup:
      "Deep brick red or espresso brown lip, warm amber bronzer, rich full-coverage gold base.",
    styling:
      "Heavy alligator leather, structured wool tweeds, antique bronze, heavy 18k hammered gold.",
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
    makeup:
      "Deep plum, midnight blackberry or dark cherry lip, flawless high-contrast porcelain base.",
    styling: "Heavy velvet, thick structured brocade, polished gunmetal, dark obsidian silver.",
  },
  "winter-clear": {
    key: "winter-clear",
    season: "Winter",
    label: "Winter Clear",
    characteristics: "High Saturation, Neon-Crisp Clarity, Striking Contrast",
    palette: SEASON_HEX_MATRIX.WINTER_CLEAR,
    makeup:
      "Electric fuchsia or high-shine crimson red lip, crisp diamond highlighter, ultra-bright clear base.",
    styling:
      "Glossy latex, stiff structural neoprene, polished brilliant diamonds, mirror-finish white gold.",
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
    styling:
      "Liquid silk satin, premium heavy grain leather, brilliant platinum, solid silver chunks.",
  },
};

export const AESTHETIC_MOODS: Array<{ id: string; name: string; desc: string; img: string }> = [
  {
    id: "minimal",
    name: "Quiet Minimal",
    desc: "Clean lines, restrained palette, architectural silhouettes.",
    img: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=200&h=300&fit=crop",
  },
  {
    id: "romantic",
    name: "Soft Romantic",
    desc: "Flowing fabrics, delicate details, muted florals.",
    img: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=200&h=300&fit=crop",
  },
  {
    id: "edgy",
    name: "Urban Edge",
    desc: "Leather, hardware, monochrome, confident structure.",
    img: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=200&h=300&fit=crop",
  },
  {
    id: "preppy",
    name: "Classic Preppy",
    desc: "Tailored blazers, crisp shirts, timeless polish.",
    img: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=200&h=300&fit=crop",
  },
  {
    id: "boho",
    name: "Modern Boho",
    desc: "Layered textures, earth tones, effortless movement.",
    img: "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=200&h=300&fit=crop",
  },
  {
    id: "glam",
    name: "Old Hollywood Glam",
    desc: "Silk, satin, statement accessories, dramatic elegance.",
    img: "https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=200&h=300&fit=crop",
  },
];
