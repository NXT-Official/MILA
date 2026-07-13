import type { Season, MatrixOption } from "./types";
import { SEASONS_MASTER_DATA } from "./data";

export const BODY_OPTIONS: MatrixOption[] = [
  {
    value: "Inverted Triangle",
    title: "Inverted Triangle",
    description: "A confident shoulder line that softens gently toward the hip.",
  },
  {
    value: "Hourglass",
    title: "Hourglass",
    description: "Shoulders and hips that echo each other, drawn in at the waist.",
  },
  {
    value: "Pear",
    title: "Pear",
    description: "A graceful lower silhouette with a softer shoulder line.",
  },
  {
    value: "Rectangle",
    title: "Rectangle",
    description: "A long, even line from shoulder to hip — clean and architectural.",
  },
  {
    value: "Apple",
    title: "Apple",
    description:
      "Volume that sits beautifully through the middle, balanced by slim wrists and ankles.",
  },
];

export const FACE_SHAPE_OPTIONS: MatrixOption[] = [
  {
    value: "Oval",
    title: "Oval",
    description: "Balanced proportions, with a jaw slightly narrower than the cheekbones.",
  },
  {
    value: "Round",
    title: "Round",
    description: "Soft curves, with cheeks and jaw of similar width and few sharp angles.",
  },
  {
    value: "Square",
    title: "Square",
    description: "A strong, angular jawline that's close in width to the forehead.",
  },
  {
    value: "Heart",
    title: "Heart",
    description: "A wider forehead and cheekbones that taper to a narrower, often pointed chin.",
  },
  {
    value: "Diamond",
    title: "Diamond",
    description: "Narrow forehead and jaw with the width concentrated at the cheekbones.",
  },
  {
    value: "Oblong",
    title: "Oblong",
    description: "A longer face shape with a forehead, cheeks, and jaw of similar width.",
  },
];

export const HAIR_TYPE_OPTIONS: MatrixOption[] = [
  {
    value: "Straight/Fine",
    title: "Straight",
    description: "Falls smooth from root to end with little to no natural bend.",
  },
  {
    value: "Wavy",
    title: "Wavy",
    description: "Forms loose S-shaped waves, somewhere between straight and curly.",
  },
  {
    value: "Curly",
    title: "Curly",
    description: "Defined spirals or coils that hold their shape from root to end.",
  },
  {
    value: "Coily/Textured",
    title: "Coily",
    description: "Tightly coiled or zig-zag texture with a lot of natural volume.",
  },
];

export const BEAUTY_PREFERENCE_TAGS = [
  "Dewy Base",
  "Glass Skin",
  "Monochromatic Peach",
  "Minimalist",
  "Bold Lip",
  "Blurred Velvet Finish",
  "Soft Smoke",
  "Editorial Brow",
  "Lacquered Lash",
  "Skin-First",
] as const;

export const MANUAL_SEASON_GROUPS: {
  season: Season;
  keys: { key: keyof typeof SEASONS_MASTER_DATA; label: string }[];
}[] = [
  {
    season: "Spring",
    keys: [
      { key: "SPRING_LIGHT", label: "Spring Light" },
      { key: "SPRING_BRIGHT", label: "Spring Bright" },
      { key: "SPRING_WARM", label: "Spring Warm" },
    ],
  },
  {
    season: "Summer",
    keys: [
      { key: "SUMMER_LIGHT", label: "Summer Light" },
      { key: "SUMMER_MUTED", label: "Summer Muted" },
      { key: "SUMMER_COOL", label: "Summer Cool" },
    ],
  },
  {
    season: "Autumn",
    keys: [
      { key: "AUTUMN_SOFT", label: "Autumn Soft" },
      { key: "AUTUMN_TRUE", label: "Autumn True" },
      { key: "AUTUMN_DEEP", label: "Autumn Deep" },
      { key: "AUTUMN_WARM", label: "Autumn Warm" },
    ],
  },
  {
    season: "Winter",
    keys: [
      { key: "WINTER_DEEP", label: "Winter Deep" },
      { key: "WINTER_CLEAR", label: "Winter Clear" },
      { key: "WINTER_TRUE", label: "Winter True" },
      { key: "WINTER_COOL", label: "Winter Cool" },
    ],
  },
];

export const KNOWN_SEASON_GROUPS: {
  season: Season;
  tiles: { id: string; label: string; key: keyof typeof SEASONS_MASTER_DATA }[];
}[] = [
  {
    season: "Spring",
    tiles: [
      { id: "spring-light", label: "Light Spring", key: "SPRING_LIGHT" },
      { id: "spring-true", label: "True Spring", key: "SPRING_TRUE" },
      { id: "spring-bright", label: "Bright Spring", key: "SPRING_BRIGHT" },
      { id: "spring-warm", label: "Warm Spring", key: "SPRING_WARM" },
    ],
  },
  {
    season: "Summer",
    tiles: [
      { id: "summer-light", label: "Light Summer", key: "SUMMER_LIGHT" },
      { id: "summer-true", label: "True Summer", key: "SUMMER_TRUE" },
      { id: "summer-muted", label: "Muted Summer", key: "SUMMER_MUTED" },
      { id: "summer-cool", label: "Cool Summer", key: "SUMMER_COOL" },
    ],
  },
  {
    season: "Autumn",
    tiles: [
      { id: "autumn-soft", label: "Soft Autumn", key: "AUTUMN_SOFT" },
      { id: "autumn-true", label: "True Autumn", key: "AUTUMN_TRUE" },
      { id: "autumn-deep", label: "Deep Autumn", key: "AUTUMN_DEEP" },
      { id: "autumn-warm", label: "Warm Autumn", key: "AUTUMN_WARM" },
    ],
  },
  {
    season: "Winter",
    tiles: [
      { id: "winter-clear", label: "Clear Winter", key: "WINTER_CLEAR" },
      { id: "winter-true", label: "True Winter", key: "WINTER_TRUE" },
      { id: "winter-deep", label: "Deep Winter", key: "WINTER_DEEP" },
      { id: "winter-cool", label: "Cool Winter", key: "WINTER_COOL" },
    ],
  },
];
