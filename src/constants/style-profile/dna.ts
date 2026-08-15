import type { Season } from "./types";

/** A palette swatch that carries its own guidance, not just a hex. */
export type NamedSwatch = { hex: string; name: string; tip: string; use: string };

/**
 * Where a hand-picked palette came from. The dossier states the season once, in
 * the hero — everything downstream credits the source instead of renaming it.
 */
export const ATELIER_PROVENANCE = "Hand-selected from the atelier library.";

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

/**
 * One named thing a directive tells you to reach for. The term used to be buried
 * in a prose sentence, which meant a member who didn't already know what a
 * "peplum" was got a conclusion and no way to act on it.
 *
 * ponytail: the definition sits on the item rather than in a shared glossary
 * keyed by term. A handful of terms repeat across seasons, which is cheaper than
 * a lookup layer that can silently miss a key. Split it out if a term ever needs
 * to be edited in one place.
 */
export type DirectiveItem = {
  term: string;
  /** Plain-language, no jargon — this is the payload for a member who is lost. */
  definition: string;
  /** Colours and metals only. Renders as an inline swatch instead of bare text. */
  hex?: string;
};

/** A styling directive: the named things to reach for, plus the caveat. */
export type Directive = {
  items: DirectiveItem[];
  /** The part that isn't a named item — the warning or the reasoning. */
  note: string;
};

/** Keyed by the body-type values in BODY_OPTIONS. */
export const SILHOUETTE_STRATEGY: Record<string, Directive> = {
  Hourglass: {
    items: [
      {
        term: "Wrap dresses",
        definition:
          "A dress that crosses over at the front and ties at the side, marking the waist.",
      },
      {
        term: "Belted knits",
        definition: "A soft jumper or cardigan pulled in with a belt instead of worn loose.",
      },
      {
        term: "Vertical lines",
        definition: "Seams, plackets or stripes that run top to bottom and lengthen the body.",
      },
    ],
    note: "Follow your natural waist — these celebrate proportion without over-styling.",
  },
  Rectangle: {
    items: [
      {
        term: "Peplum",
        definition: "A short flared ruffle at the waist of a top or jacket that creates a curve.",
      },
      {
        term: "Pleats",
        definition: "Folds pressed into fabric that add movement and volume where you want it.",
      },
      {
        term: "A defined waist",
        definition: "Any belt, seam or tie that marks the narrowest point of your torso.",
      },
    ],
    note: "Layered volume reads softer than fitted head-to-toe.",
  },
  Pear: {
    items: [
      {
        term: "Statement necklines",
        definition: "A boat neck, square neck or wide collar that draws the eye up to the face.",
      },
      {
        term: "Structured tops",
        definition:
          "Tops holding their own shape — a firm shoulder, a crisp shirt, a light jacket.",
      },
      {
        term: "Soft lower volume",
        definition: "Skirts and trousers that skim rather than cling through the hip and thigh.",
      },
    ],
    note: "Balance the shoulder line and the eye travels upward.",
  },
  "Inverted Triangle": {
    items: [
      {
        term: "V-necks",
        definition: "A neckline cut to a point, which narrows a broad shoulder line.",
      },
      {
        term: "A-line skirts",
        definition:
          "A skirt narrow at the waist that widens steadily to the hem, like the letter A.",
      },
      {
        term: "Wide-leg denim",
        definition: "Jeans cut straight and loose from hip to ankle, adding weight low down.",
      },
    ],
    note: "Fluid drape softens the shoulder; volume at the hip balances it.",
  },
  Apple: {
    items: [
      {
        term: "Open necklines",
        definition: "A scoop or V that leaves the collarbone visible and lifts the eye.",
      },
      {
        term: "Empire waists",
        definition: "A seam sitting just under the bust, with the fabric falling loose below it.",
      },
      {
        term: "Straight trousers",
        definition: "A clean, unbroken leg line from hip to hem — no taper, no flare.",
      },
    ],
    note: "Keep the leg-line long and clean and the whole shape reads taller.",
  },
};

/** Keyed by the hair-type values in HAIR_TYPE_OPTIONS. */
export const HAIR_DIRECTION: Record<string, Directive> = {
  "Straight/Fine": {
    items: [
      {
        term: "Precision cuts",
        definition: "A sharp, exactly-measured shape — the cut itself does the work, not styling.",
      },
      {
        term: "Blunt ends",
        definition: "Ends cut straight across rather than tapered, so the hair looks denser.",
      },
      {
        term: "Glossy finishes",
        definition:
          "A smooth, light-reflecting surface — serum or a gloss treatment, not hairspray.",
      },
    ],
    note: "Avoid heavy layering — it thins the shape.",
  },
  Wavy: {
    items: [
      {
        term: "Mid-length shapes",
        definition: "Length that lands between the collarbone and just past the shoulder.",
      },
      {
        term: "Soft internal layers",
        definition: "Layers cut inside the hair, invisible from outside, that release the wave.",
      },
      {
        term: "Sea-salt texture",
        definition: "The loose, undone finish of hair dried after a swim — matte, not crisp.",
      },
    ],
    note: "Never a stiff curl — the wave should still move.",
  },
  Curly: {
    items: [
      {
        term: "Curl-defined styling",
        definition: "Product applied to wet hair so each curl dries as one clean spiral.",
      },
      {
        term: "Weight left in",
        definition: "Keeping length and bulk so curls stretch downward instead of pyramiding.",
      },
      {
        term: "Shape trims",
        definition: "Cutting the outline only, rather than thinning bulk out from underneath.",
      },
    ],
    note: "Trim shape, don't thin — density is the look.",
  },
  "Coily/Textured": {
    items: [
      {
        term: "Sculpted volume",
        definition: "Height and shape built deliberately, treating the hair as a silhouette.",
      },
      {
        term: "Protective silhouettes",
        definition: "Braids, twists or buns that tuck the ends away and spare them daily wear.",
      },
      {
        term: "Light-catching finishes",
        definition: "An oil or butter that leaves a soft sheen without swelling the cuticle.",
      },
    ],
    note: "Finishes should catch light without frizz.",
  },
};

/** Hexes are the palette's own — a colour app should never name a colour in plain text. */
export const MAKEUP_HARMONY: Record<Season, Directive> = {
  Spring: {
    items: [
      {
        term: "Clear peach",
        hex: "#F5B39A",
        definition: "A soft warm pink-orange, closer to fruit than to brown.",
      },
      {
        term: "Warm coral",
        hex: "#FF7F50",
        definition: "A vivid orange-pink — your palette's natural lip.",
      },
      {
        term: "Luminous ivory base",
        hex: "#FDF6E3",
        definition: "A warm off-white foundation with a lit finish, never flat or chalky.",
      },
    ],
    note: "Skip anything ashy or grey-toned.",
  },
  Summer: {
    items: [
      {
        term: "Dusty rose",
        hex: "#D19DAA",
        definition: "A muted cool pink with the brightness taken out of it.",
      },
      {
        term: "Cool mauve",
        hex: "#C08497",
        definition: "A greyed purple-pink that adds depth without adding warmth.",
      },
      {
        term: "Soft matte base",
        hex: "#EEE6EA",
        definition: "A foundation with no shine — light sits evenly rather than reflecting.",
      },
    ],
    note: "Ashy tones flatter you.",
  },
  Autumn: {
    items: [
      {
        term: "Terracotta",
        hex: "#B8651A",
        definition: "The warm red-brown of clay pots — grounded, never bright.",
      },
      {
        term: "Burnt sienna",
        hex: "#D2691E",
        definition: "A deeper rust-orange with brown underneath it.",
      },
      {
        term: "Warm bronze",
        hex: "#A0662A",
        definition: "A metallic brown-gold, best on the eye.",
      },
    ],
    note: "Reach for gold, never silver.",
  },
  Winter: {
    items: [
      {
        term: "Deep berry",
        hex: "#7A1F3D",
        definition: "A dark cool red with blue underneath — blackcurrant, not brick.",
      },
      {
        term: "True red",
        hex: "#B22222",
        definition: "Pure red that leans neither orange nor purple.",
      },
      {
        term: "Cool nude",
        hex: "#E8ECF1",
        definition: "A neutral that stays on the grey-pink side, never beige or golden.",
      },
    ],
    note: "Contrast is your signal — don't mute it.",
  },
};

export const TEXTILE_DIRECTION: Record<Season, Directive> = {
  Spring: {
    items: [
      {
        term: "Fine cottons",
        definition: "Lightweight, tightly woven cotton — crisp to the touch, holds a clean edge.",
      },
      {
        term: "Chiffon",
        definition: "A sheer, weightless fabric that floats and gathers rather than holding shape.",
      },
      {
        term: "Polished 14k gold",
        hex: "#D4AF37",
        definition: "Warm yellow gold with a mirror finish — bright rather than antiqued.",
      },
      {
        term: "Seed pearls",
        hex: "#F0EAD6",
        definition: "Very small round pearls, usually clustered, with a soft warm lustre.",
      },
    ],
    note: "Light-handed textures that stay crisp, never heavy.",
  },
  Summer: {
    items: [
      {
        term: "Silk crepe",
        definition: "Silk with a faint grainy surface that hangs in a soft, fluid drape.",
      },
      {
        term: "Brushed wool",
        definition: "Wool raised into a light fuzz on the surface, softening the colour.",
      },
      {
        term: "Matte satin",
        definition: "Satin's drape with the shine dialled down to a low sheen.",
      },
      {
        term: "Brushed silver",
        hex: "#C0C5CE",
        definition: "Cool silver with a fine-grain finish that scatters light instead of flashing.",
      },
    ],
    note: "Soft-focus surfaces suit your lower contrast.",
  },
  Autumn: {
    items: [
      {
        term: "Suede",
        definition: "Leather buffed on the underside to a velvety nap that reads matte and warm.",
      },
      {
        term: "Tweed",
        definition: "A thick wool woven from flecks of several colours at once.",
      },
      {
        term: "Brushed leather",
        definition: "Leather with the shine worked off, leaving a dry, tactile surface.",
      },
      {
        term: "Antique gold",
        hex: "#DAA520",
        definition: "Gold darkened at the edges so it reads aged rather than new.",
      },
    ],
    note: "Texture carries your palette further than shine does.",
  },
  Winter: {
    items: [
      {
        term: "Structured wool",
        definition: "Firm wool with enough body to hold a shoulder or a sharp lapel.",
      },
      {
        term: "Mirror-finish silk",
        definition: "High-shine silk — satin or charmeuse — that reflects light cleanly.",
      },
      {
        term: "Platinum",
        hex: "#E5E4E2",
        definition: "A bright, cool white metal that stays silver-toned and doesn't yellow.",
      },
      {
        term: "Jet",
        hex: "#050505",
        definition: "A dense, glassy black stone cut for depth rather than sparkle.",
      },
    ],
    note: "Clean, hard surfaces match your natural contrast.",
  },
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
