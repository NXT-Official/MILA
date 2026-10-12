/**
 * Which garment a recommended product is. Shop photos often show a whole
 * outfit (a model in a shirt, trousers and a cap), so every recommendation
 * carries a plain label saying which piece Mila means. A wrong label is
 * worse than none, so when the name gives no confident answer the label is
 * the category's own word ("Outerwear"), never a guess.
 *
 * The rules, identical in MILA_MOBILE (src/lib/garment-label.ts there; change
 * both together, a parity check compares them over the whole catalog):
 *
 * 1. The category decides the kind. A category this file does not know keeps
 *    its own word as the label.
 * 2. Only the product name is read: the text before the first "|". Catalog
 *    titles are "Name | Colour | Size", and a colour can itself be a garment
 *    word ("Baggy Chino | Trench Coat Khaki"). A trailing " with ..." or
 *    " in ..." clause is set aside ("Mod Coat with Liner Vest" is a coat); if
 *    that clause held the only garment word ("Made in Italy Ballet Flat"),
 *    the whole name is read instead.
 * 3. The head noun names it: the garment word that ends last in the name
 *    ("Hat Bead Charm" is a charm, "Chino Short" is shorts). When two end on
 *    the same word, the longer phrase wins ("Polo Shirt" is a polo, "Tote Bag"
 *    is a tote). Singular and plural forms are both listed.
 * 4. Never guess: the head noun refines the label only on a shelf it belongs
 *    to (`within`); a few move the piece to its real kind (a clutch filed
 *    under Accessories is a bag). Any other head noun, or none at all, and
 *    the category's own label stands.
 */

export const GARMENT_KINDS = [
  "top",
  "bottoms",
  "dress",
  "outerwear",
  "shoes",
  "bag",
  "jewelry",
  "accessory",
  "unknown",
] as const;

export type GarmentKind = (typeof GARMENT_KINDS)[number];

export type Garment = { kind: GarmentKind; label: string };

export type GarmentKeyword = {
  /**
   * Whole words or phrases, normalised like a title: lowercase, digits kept,
   * every run of anything else one space ("T-Shirt" is "t shirt"). Singular
   * and plural are both listed.
   */
  words: readonly string[];
  label: string;
  /** The shelves (category kinds) this noun may name a piece on. */
  within: readonly GarmentKind[];
  /** The kind the piece becomes when matched. Omitted: the category's kind stays. */
  kind?: GarmentKind;
};

/**
 * The one keyword table, the same entries in the same order as mobile's.
 * Which entry wins is decided by position in the name (rule 3), not by order
 * here; order only breaks a tie between two equally long matches ending on
 * the same word.
 */
export const GARMENT_KEYWORDS: readonly GarmentKeyword[] = [
  // Bags, including the ones the catalogue files under Accessories.
  {
    words: ["belt bag", "belt bags", "bum bag", "bum bags", "fanny pack", "fanny packs"],
    label: "Belt bag",
    within: ["bag", "accessory"],
    kind: "bag",
  },
  {
    words: ["clutch", "clutches"],
    label: "Clutch",
    within: ["bag", "accessory"],
    kind: "bag",
  },
  {
    words: ["tote", "totes", "tote bag", "tote bags"],
    label: "Tote",
    within: ["bag", "accessory"],
    kind: "bag",
  },
  {
    words: ["backpack", "backpacks", "rucksack", "rucksacks"],
    label: "Backpack",
    within: ["bag", "accessory"],
    kind: "bag",
  },
  {
    words: ["bag", "bags", "handbag", "handbags", "purse", "purses"],
    label: "Bag",
    within: ["bag", "accessory"],
    kind: "bag",
  },

  // Tops.
  { words: ["t shirt", "t shirts", "tee", "tees"], label: "T-shirt", within: ["top"] },
  {
    words: ["sweater", "sweaters", "jumper", "jumpers", "pullover", "pullovers"],
    label: "Sweater",
    within: ["top"],
  },
  {
    words: ["sweatshirt", "sweatshirts", "hoodie", "hoodies"],
    label: "Sweatshirt",
    within: ["top"],
  },
  { words: ["cardigan", "cardigans"], label: "Cardigan", within: ["top", "outerwear"] },
  { words: ["blouse", "blouses"], label: "Blouse", within: ["top"] },
  {
    words: ["shirt", "shirts", "button down", "button downs", "button up", "button ups"],
    label: "Shirt",
    within: ["top"],
  },
  {
    words: ["tank", "tanks", "camisole", "camisoles", "cami", "camis"],
    label: "Tank top",
    within: ["top"],
  },
  { words: ["bodysuit", "bodysuits"], label: "Bodysuit", within: ["top"] },
  {
    words: ["polo", "polos", "polo shirt", "polo shirts"],
    label: "Polo",
    within: ["top"],
  },

  // Bottoms.
  {
    words: ["skirt", "skirts", "miniskirt", "miniskirts", "skort", "skorts"],
    label: "Skirt",
    within: ["bottoms"],
  },
  { words: ["short", "shorts", "bermudas"], label: "Shorts", within: ["bottoms"] },
  { words: ["jean", "jeans", "denim"], label: "Jeans", within: ["bottoms"] },
  { words: ["legging", "leggings"], label: "Leggings", within: ["bottoms"] },
  {
    words: ["jogger", "joggers", "sweatpant", "sweatpants"],
    label: "Joggers",
    within: ["bottoms"],
  },
  {
    words: ["trouser", "trousers", "pant", "pants", "slacks", "chino", "chinos"],
    label: "Trousers",
    within: ["bottoms"],
  },

  // Dresses.
  { words: ["jumpsuit", "jumpsuits"], label: "Jumpsuit", within: ["dress"] },

  // Outerwear (the catalogue also files vests and fleece half-zips here).
  { words: ["vest", "vests", "gilet", "gilets"], label: "Vest", within: ["outerwear"] },
  {
    words: ["half zip", "half zips", "quarter zip", "quarter zips"],
    label: "Half-zip",
    within: ["outerwear"],
  },
  { words: ["fleece", "fleeces"], label: "Fleece", within: ["outerwear"] },
  {
    words: ["coat", "coats", "overcoat", "overcoats", "trench", "trenches", "parka", "parkas"],
    label: "Coat",
    within: ["outerwear"],
  },
  { words: ["blazer", "blazers"], label: "Blazer", within: ["outerwear"] },
  {
    words: ["jacket", "jackets", "bomber", "bombers", "shacket", "shackets"],
    label: "Jacket",
    within: ["outerwear"],
  },

  // Shoes.
  {
    words: ["sneaker", "sneakers", "trainer", "trainers"],
    label: "Sneakers",
    within: ["shoes"],
  },
  {
    words: ["boot", "boots", "bootie", "booties"],
    label: "Boots",
    within: ["shoes"],
  },
  {
    words: ["sandal", "sandals", "slide", "slides"],
    label: "Sandals",
    within: ["shoes"],
  },
  { words: ["loafer", "loafers"], label: "Loafers", within: ["shoes"] },
  { words: ["mule", "mules"], label: "Mules", within: ["shoes"] },
  {
    words: ["flat", "flats", "ballet flat", "ballet flats", "ballerina", "ballerinas"],
    label: "Flats",
    within: ["shoes"],
  },
  {
    words: ["heel", "heels", "pump", "pumps", "stiletto", "stilettos", "slingback", "slingbacks"],
    label: "Heels",
    within: ["shoes"],
  },

  // Jewelry.
  {
    words: [
      "earring",
      "earrings",
      "stud",
      "studs",
      "hoop",
      "hoops",
      "huggie",
      "huggies",
      "ear cuff",
      "ear cuffs",
    ],
    label: "Earrings",
    within: ["jewelry"],
  },
  {
    words: ["necklace", "necklaces", "pendant", "pendants", "choker", "chokers"],
    label: "Necklace",
    within: ["jewelry"],
  },
  {
    words: ["bracelet", "bracelets", "bangle", "bangles", "cuff", "cuffs"],
    label: "Bracelet",
    within: ["jewelry"],
  },
  { words: ["ring", "rings"], label: "Ring", within: ["jewelry"] },
  { words: ["brooch", "brooches"], label: "Brooch", within: ["jewelry"] },
  {
    words: ["watch", "watches"],
    label: "Watch",
    within: ["jewelry", "accessory"],
  },
  { words: ["charm", "charms"], label: "Charm", within: ["jewelry", "accessory"] },

  // Accessories.
  {
    words: ["sunglasses", "sunnies", "shades"],
    label: "Sunglasses",
    within: ["accessory"],
  },
  { words: ["sock", "socks"], label: "Socks", within: ["accessory"] },
  { words: ["belt", "belts"], label: "Belt", within: ["accessory"] },
  {
    words: [
      "scarf",
      "scarves",
      "neck wrap",
      "neck wraps",
      "bandana",
      "bandanas",
      "shawl",
      "shawls",
    ],
    label: "Scarf",
    within: ["accessory"],
  },
  { words: ["cap", "caps"], label: "Cap", within: ["accessory"] },
  { words: ["beanie", "beanies"], label: "Beanie", within: ["accessory"] },
  {
    words: ["hat", "hats", "fedora", "fedoras", "beret", "berets", "bucket hat", "bucket hats"],
    label: "Hat",
    within: ["accessory"],
  },
  {
    words: ["glove", "gloves", "mitten", "mittens"],
    label: "Gloves",
    within: ["accessory"],
  },
  { words: ["tie", "ties", "necktie", "neckties"], label: "Tie", within: ["accessory"] },
];
const CATEGORY_KINDS: Readonly<Record<string, GarmentKind>> = {
  top: "top",
  tops: "top",
  bottom: "bottoms",
  bottoms: "bottoms",
  dress: "dress",
  dresses: "dress",
  outerwear: "outerwear",
  shoe: "shoes",
  shoes: "shoes",
  bag: "bag",
  bags: "bag",
  jewelry: "jewelry",
  jewellery: "jewelry",
  accessory: "accessory",
  accessories: "accessory",
};

const DEFAULT_LABELS: Readonly<Record<GarmentKind, string>> = {
  top: "Top",
  bottoms: "Bottoms",
  dress: "Dress",
  outerwear: "Outerwear",
  shoes: "Shoes",
  bag: "Bag",
  jewelry: "Jewelry",
  accessory: "Accessory",
  unknown: "Piece",
};

/** Lowercase words and digits; everything else separates them ("T-Shirt" is t, shirt). */
function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Every keyword as its word sequence, kept beside its entry and its place in the table. */
const PHRASES = GARMENT_KEYWORDS.flatMap((entry, order) =>
  entry.words.map((phrase) => ({ entry, order, tokens: phrase.split(" ") })),
);

/**
 * The head noun of a name: the keyword match that ends last, the longer
 * phrase on a tie at the same word, then the earlier table entry.
 */
function headNoun(name: string): GarmentKeyword | null {
  const tokens = words(name);
  let best: { end: number; length: number; order: number; entry: GarmentKeyword } | null = null;

  for (const { entry, order, tokens: phrase } of PHRASES) {
    for (let start = 0; start + phrase.length <= tokens.length; start += 1) {
      if (!phrase.every((token, offset) => tokens[start + offset] === token)) continue;
      const end = start + phrase.length - 1;
      const better =
        !best ||
        end > best.end ||
        (end === best.end && phrase.length > best.length) ||
        (end === best.end && phrase.length === best.length && order < best.order);
      if (better) best = { end, length: phrase.length, order, entry };
    }
  }
  return best?.entry ?? null;
}

/** The product's own name: catalog titles read "Name | Colour | Size" (rule 2). */
export function productName(title: string): string {
  return title.split("|")[0].trim();
}

/**
 * The names to read, in order (rule 2): the name without its " with ..." or
 * " in ..." clause, then the whole name. Never the colour or size after "|".
 */
function productNames(title: string): string[] {
  const name = title.split("|")[0];
  const withoutClause = name.split(/\s(?:with|in)\s/i)[0];
  return withoutClause === name ? [name] : [withoutClause, name];
}

export function garmentFor(category: string | null | undefined, title?: string | null): Garment {
  const categoryText = (category ?? "").trim();
  const shelf = CATEGORY_KINDS[categoryText.toLowerCase()];
  if (!shelf) return { kind: "unknown", label: categoryText || DEFAULT_LABELS.unknown };

  const fallback: Garment = { kind: shelf, label: DEFAULT_LABELS[shelf] };
  if (!title) return fallback;

  for (const name of productNames(title)) {
    const head = headNoun(name);
    if (!head) continue;
    // A head noun from another shelf is not a confident answer (rule 4).
    if (!head.within.includes(shelf)) return fallback;
    return { kind: head.kind ?? shelf, label: head.label };
  }
  return fallback;
}

/** Image alt for a recommended product: what it is, then which piece Mila means. */
export function recommendationAlt(title: string, garment: Garment): string {
  return `${title}. Mila is recommending the ${garment.label.toLowerCase()}`;
}

/** The text line under a recommended product's photo. */
export function garmentLine(garment: Garment, title: string): string {
  return `${garment.label}: ${title}`;
}

/** Head-to-toe order for grouped lists. */
export const GARMENT_KIND_ORDER: readonly GarmentKind[] = [
  "outerwear",
  "top",
  "dress",
  "bottoms",
  "shoes",
  "bag",
  "jewelry",
  "accessory",
  "unknown",
];

const KIND_HEADINGS: Readonly<Record<GarmentKind, string>> = {
  top: "Tops",
  bottoms: "Bottoms",
  dress: "Dresses",
  outerwear: "Outerwear",
  shoes: "Shoes",
  bag: "Bags",
  jewelry: "Jewelry",
  accessory: "Accessories",
  unknown: "Other pieces",
};

export function garmentKindHeading(kind: GarmentKind): string {
  return KIND_HEADINGS[kind];
}
