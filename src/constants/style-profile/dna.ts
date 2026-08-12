import type { Season } from "./types";

/** A palette swatch that carries its own guidance, not just a hex. */
export type NamedSwatch = { hex: string; name: string; tip: string; use: string };

export const SEASON_ONE_LINER: Record<Season, string> = {
  Spring: "A warm, clear palette that suits sun-lifted, luminous colour.",
  Summer: "A cool, soft palette that suits muted, elegant, low-contrast colour.",
  Autumn: "A warm, grounded palette that suits burnished, earth-toned colour.",
  Winter: "A cool, high-pigment palette that suits crisp, contrasting colour.",
};

export type MakeupLook = {
  id: string;
  category: "Lips" | "Cheeks" | "Eyes" | "Highlight" | "Full Look";
  name: string;
  hex: string;
  note: string;
};

export const MAKEUP_CATEGORIES = ["Lips", "Cheeks", "Eyes", "Highlight", "Full Look"] as const;

export const MAKEUP_LOOKS: Record<Season, MakeupLook[]> = {
  Spring: [
    {
      id: "sp-l1",
      category: "Lips",
      name: "Fresh Coral",
      hex: "#FF7F50",
      note: "A juicy warm coral — your palette's natural lip.",
    },
    {
      id: "sp-l2",
      category: "Lips",
      name: "Peach Glaze",
      hex: "#F5B39A",
      note: "Soft, glossy, and daytime-ready.",
    },
    {
      id: "sp-c1",
      category: "Cheeks",
      name: "Warm Apricot Flush",
      hex: "#F4A57A",
      note: "Sits high on the cheek for a lit-from-within look.",
    },
    {
      id: "sp-e1",
      category: "Eyes",
      name: "Honey Warm Neutral",
      hex: "#C5A059",
      note: "Warm gold neutrals — never cool taupes.",
    },
    {
      id: "sp-h1",
      category: "Highlight",
      name: "Champagne Gold",
      hex: "#E9D9A6",
      note: "Warm gold sheen along the cheekbone.",
    },
    {
      id: "sp-f1",
      category: "Full Look",
      name: "Sunlit Fresh",
      hex: "#FFB347",
      note: "Peach cheek, coral lip, gold highlight — luminous and effortless.",
    },
  ],
  Summer: [
    {
      id: "su-l1",
      category: "Lips",
      name: "Muted Mauve Lip",
      hex: "#C08497",
      note: "Soft definition that stays within your natural contrast level.",
    },
    {
      id: "su-l2",
      category: "Lips",
      name: "Dusty Rose",
      hex: "#D19DAA",
      note: "The everyday cool-neutral — quiet and elegant.",
    },
    {
      id: "su-c1",
      category: "Cheeks",
      name: "Cool Rose Wash",
      hex: "#D5A9B0",
      note: "A whisper of cool pink — never peach.",
    },
    {
      id: "su-e1",
      category: "Eyes",
      name: "Soft Taupe Smoke",
      hex: "#8C92AC",
      note: "Cool taupe blur — flatters without overpowering.",
    },
    {
      id: "su-h1",
      category: "Highlight",
      name: "Pearl Sheen",
      hex: "#EEE6EA",
      note: "A cool pearl gloss — silver-leaning, never gold.",
    },
    {
      id: "su-f1",
      category: "Full Look",
      name: "Quiet Rose",
      hex: "#C08497",
      note: "Cool rose cheek, mauve lip, pearl highlight — soft and refined.",
    },
  ],
  Autumn: [
    {
      id: "au-l1",
      category: "Lips",
      name: "Terracotta Lip",
      hex: "#B8651A",
      note: "Warm and grounded — the heart of your palette.",
    },
    {
      id: "au-l2",
      category: "Lips",
      name: "Spiced Brick",
      hex: "#8B4513",
      note: "Deeper matte for evening — reads sculptural.",
    },
    {
      id: "au-c1",
      category: "Cheeks",
      name: "Warm Cinnamon Flush",
      hex: "#C97B5A",
      note: "Warmth pulled onto the apple of the cheek.",
    },
    {
      id: "au-e1",
      category: "Eyes",
      name: "Bronze Molten",
      hex: "#A0662A",
      note: "Molten warm bronze — your signature eye.",
    },
    {
      id: "au-h1",
      category: "Highlight",
      name: "Antique Gold",
      hex: "#DAA520",
      note: "Warm gold, never silver — sits high on the cheekbone.",
    },
    {
      id: "au-f1",
      category: "Full Look",
      name: "Burnished Warm",
      hex: "#B8651A",
      note: "Terracotta lip, bronze eye, gold highlight — quietly rich.",
    },
  ],
  Winter: [
    {
      id: "wi-l1",
      category: "Lips",
      name: "True Crimson",
      hex: "#B22222",
      note: "Pure pigment — your signature statement lip.",
    },
    {
      id: "wi-l2",
      category: "Lips",
      name: "Cool Berry",
      hex: "#7A1F3D",
      note: "Deep, cool, saturated — perfect for evening.",
    },
    {
      id: "wi-c1",
      category: "Cheeks",
      name: "Cool Rose Pop",
      hex: "#C24E6E",
      note: "Cool bright pink — never dusty or warm.",
    },
    {
      id: "wi-e1",
      category: "Eyes",
      name: "Smoke Charcoal",
      hex: "#2E2E36",
      note: "Clean cool smoke — contrast is your compliment.",
    },
    {
      id: "wi-h1",
      category: "Highlight",
      name: "Silver Frost",
      hex: "#E8ECF1",
      note: "Cool platinum sheen — sharp and modern.",
    },
    {
      id: "wi-f1",
      category: "Full Look",
      name: "Sharp Statement",
      hex: "#B22222",
      note: "Crimson lip, cool smoke eye, silver highlight — high-contrast clarity.",
    },
  ],
};

/** Keyed by the body-type values in BODY_OPTIONS. */
export const SILHOUETTE_STRATEGY: Record<string, string> = {
  Hourglass:
    "Follow your natural waist. Wrap dresses, belted knits, and clean vertical lines celebrate proportion without over-styling.",
  Rectangle:
    "Create dimension with layered volumes — peplum, pleats, and a defined waist read more feminine than fitted head-to-toe.",
  Pear: "Balance shoulders with softer lower-body volume. Statement necklines and structured tops lift the eye up.",
  "Inverted Triangle":
    "Soften shoulders with fluid drapes and V-necks; add hip volume through A-lines, wide-leg denim, and pleated skirts.",
  Apple:
    "Draw the eye up with open necklines and empire waists. Straight or slim trousers keep the leg-line long and clean.",
};

/** Keyed by the hair-type values in HAIR_TYPE_OPTIONS. */
export const HAIR_DIRECTION: Record<string, string> = {
  "Straight/Fine":
    "Precision cuts, blunt ends, and glossy finishes. Avoid heavy layering — it thins the shape.",
  Wavy: "Mid-length shapes with soft internal layers. Sea-salt texture, never a stiff curl.",
  Curly: "Curl-defined styling with weight left in. Trim shape, don't thin — density is the look.",
  "Coily/Textured":
    "Sculpted volume, protective silhouettes, and finishes that catch light without frizz.",
};

export const MAKEUP_HARMONY: Record<Season, string> = {
  Spring: "Clear peach, warm coral, luminous ivory base. Skip anything ashy or grey-toned.",
  Summer: "Dusty rose, cool mauve, and a soft matte or satin base. Ashy tones flatter you.",
  Autumn: "Terracotta, burnt sienna, warm bronze. Reach for gold, never silver.",
  Winter: "Deep berry, true red, cool nude. Contrast is your signal — don't mute it.",
};

export const TEXTILE_DIRECTION: Record<Season, string> = {
  Spring: "Fine cottons, chiffon, polished 14k yellow gold, seed pearls.",
  Summer: "Silk crepe, brushed wool, matte satin, softly-brushed silver.",
  Autumn: "Suede, tweed, brushed leather, aged brass and antique gold.",
  Winter: "Structured wool, mirror-finish silk, high-shine platinum and jet.",
};

export const NAMED_PALETTE: Record<
  Season,
  {
    primary: NamedSwatch[];
    accents: NamedSwatch[];
    neutrals: NamedSwatch[];
    avoid: NamedSwatch[];
  }
> = {
  Spring: {
    primary: [
      {
        hex: "#FFB347",
        name: "Warm Apricot",
        tip: "Lifts your skin instantly.",
        use: "Knits, silk blouses",
      },
      {
        hex: "#FFC0CB",
        name: "Peach Blossom",
        tip: "Softer than pink, warmer than nude.",
        use: "Daytime, near the face",
      },
      {
        hex: "#7FFF00",
        name: "Fresh Grass",
        tip: "Adds clarity without weight.",
        use: "Accessories, spring layers",
      },
      {
        hex: "#FFD166",
        name: "Marigold",
        tip: "Your signature warm neutral.",
        use: "Coats, structured pieces",
      },
    ],
    accents: [
      {
        hex: "#FF7F50",
        name: "Coral",
        tip: "Best when you want energy.",
        use: "Statement tops, lip",
      },
      {
        hex: "#40E0D0",
        name: "Turquoise",
        tip: "Clear and bright — never dusty.",
        use: "Jewellery, silk scarves",
      },
    ],
    neutrals: [
      {
        hex: "#FDF6E3",
        name: "Warm Ivory",
        tip: "Your best white — never stark.",
        use: "Base layers",
      },
      { hex: "#C5A059", name: "Honey Camel", tip: "Warmer than beige.", use: "Trench, tailoring" },
    ],
    avoid: [
      { hex: "#0B0B0B", name: "Hard Black", tip: "Overpowers your warmth.", use: "" },
      { hex: "#5D6D7E", name: "Cold Slate", tip: "Reads dull against you.", use: "" },
    ],
  },
  Summer: {
    primary: [
      {
        hex: "#8DA9D6",
        name: "Pigeon Blue",
        tip: "Elegant and quietly cool.",
        use: "Knits, tailoring",
      },
      {
        hex: "#87A96B",
        name: "Soft Sage",
        tip: "Best for knits and soft daytime dressing.",
        use: "Blouses, cardigans",
      },
      {
        hex: "#C08497",
        name: "Muted Raspberry",
        tip: "Beautiful near the face for gentle depth.",
        use: "Sweaters, lip",
      },
      { hex: "#D8BFD8", name: "Mauve", tip: "Romantic without going warm.", use: "Silks, evening" },
    ],
    accents: [
      {
        hex: "#7986CB",
        name: "Periwinkle",
        tip: "Cool sparkle without brightness.",
        use: "Silks, denim tones",
      },
      {
        hex: "#C8A2C8",
        name: "Dusty Lavender",
        tip: "Softens tailored pieces.",
        use: "Suiting, scarves",
      },
    ],
    neutrals: [
      {
        hex: "#EAECEE",
        name: "Soft Pearl",
        tip: "Your best white — a cool-warm hush.",
        use: "Shirts, base layers",
      },
      {
        hex: "#8C92AC",
        name: "Cool Taupe",
        tip: "Reads richer than grey on you.",
        use: "Trousers, coats",
      },
    ],
    avoid: [
      { hex: "#FF4500", name: "Orange-Red", tip: "Too warm — pulls colour out.", use: "" },
      { hex: "#B7950B", name: "Mustard", tip: "Muddies your natural coolness.", use: "" },
    ],
  },
  Autumn: {
    primary: [
      {
        hex: "#B8651A",
        name: "Burnt Sienna",
        tip: "Warm depth, endlessly wearable.",
        use: "Outerwear, knits",
      },
      { hex: "#6B8E23", name: "Moss Green", tip: "Grounding and rich.", use: "Suiting, denim" },
      { hex: "#DAA520", name: "Antique Gold", tip: "Your best metallic.", use: "Jewellery, silks" },
      {
        hex: "#8B4513",
        name: "Warm Chocolate",
        tip: "Deeper than black on you.",
        use: "Leather, tailoring",
      },
    ],
    accents: [
      {
        hex: "#D2691E",
        name: "Spiced Rust",
        tip: "Adds fire without brightness.",
        use: "Statement layers",
      },
      {
        hex: "#2E8B57",
        name: "Deep Teal",
        tip: "Cool-warm — rare colour that reads jewel.",
        use: "Blouses, dresses",
      },
    ],
    neutrals: [
      {
        hex: "#F5DEB3",
        name: "Wheat",
        tip: "Softer than white — golden light.",
        use: "Base layers",
      },
      { hex: "#5C4033", name: "Bark", tip: "Your true dark neutral.", use: "Trousers, boots" },
    ],
    avoid: [
      { hex: "#FF69B4", name: "Hot Pink", tip: "Cool tone competes with warmth.", use: "" },
      { hex: "#EAF6FF", name: "Icy Blue", tip: "Washes out earth tones.", use: "" },
    ],
  },
  Winter: {
    primary: [
      {
        hex: "#0B3C5D",
        name: "Ink Navy",
        tip: "Cleaner than black, cooler than blue.",
        use: "Suiting, coats",
      },
      {
        hex: "#B22222",
        name: "True Crimson",
        tip: "Your signature statement.",
        use: "Lip, dresses",
      },
      { hex: "#004B49", name: "Emerald", tip: "Pure jewel-tone clarity.", use: "Silks, evening" },
      {
        hex: "#4B0082",
        name: "Deep Violet",
        tip: "Cool, saturated, formal.",
        use: "Formal tailoring",
      },
    ],
    accents: [
      {
        hex: "#FF1493",
        name: "Shocking Pink",
        tip: "Contrast is your compliment.",
        use: "Statement pieces",
      },
      { hex: "#00FFFF", name: "Icy Cyan", tip: "Cool sparkle — never dusty.", use: "Accessories" },
    ],
    neutrals: [
      {
        hex: "#FFFFFF",
        name: "Pure White",
        tip: "Yes, actual white — it reads clean on you.",
        use: "Shirts",
      },
      {
        hex: "#050505",
        name: "Jet Black",
        tip: "Not overpowering — it grounds you.",
        use: "Tailoring, boots",
      },
    ],
    avoid: [
      { hex: "#CD853F", name: "Camel", tip: "Warm neutrals mute your contrast.", use: "" },
      { hex: "#F5DEB3", name: "Beige", tip: "Reads flat against cool undertone.", use: "" },
    ],
  },
};
