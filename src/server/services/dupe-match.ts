import type {
  Closure,
  DupeAttributes,
  Formality,
  GarmentLength,
  GarmentType,
  Pattern,
} from "@/lib/dupe-spec";

/**
 * Deterministic garment matching for the Dupe Hunter: what kind of garment a
 * catalogue row is, how dressed-up it reads, its pattern, colour, length and
 * fabric, read from the row's title and description, and how close all of
 * that is to the piece the member photographed.
 *
 * Category alone is not enough: the catalogue's "Outerwear" holds tailored
 * coats beside track jackets, fleeces, puffers and vests. Before this, every
 * Outerwear row earned the same category points, ties went to the cheapest
 * row, and a formal striped coat came back as a list of sports jackets. Here
 * a different garment kind, an incompatible gender fit or a formality two
 * steps away (a track jacket for a tailored coat) rules a row out entirely,
 * and what is left gets a 0-100 similarity the caller thresholds.
 *
 * The products table has no colour, pattern or kind columns, so all of this
 * is read from text. This deterministic score is the whole match decision:
 * the hunt makes one AI call (the vision read of the photo) and no second AI
 * stage judges the survivors (src/server/services/dupes.ts).
 *
 * Signals are graded. The product NAME (the title before "|") is strong and
 * may rule a row out. The colourway after "|" is read for the print only
 * ("| Pale Khaki Plaid"), never for kind or department ("| Men's Navy" is a
 * colour). The description never rules a row out, because shop copy is full
 * of stray words ("Stick? Check.", "tennis" earrings, "flower-scented air"):
 * it confirms and adds points, and when it CONTRADICTS the hunt (it names a
 * print for a plain hunt, the other department, or a register two steps
 * away) it caps the row just under the threshold, so it is not shown. Our
 * own kind defaults ("a sandal is usually casual") only ever score.
 */

/**
 * Minimum 0-100 similarity for a catalogue piece to be shown. Below it the
 * piece is a different garment, and an empty result is better than an
 * unrelated one.
 *
 * CALIBRATED 2026-10-08 against replays of real member hunts over the live
 * catalogue (a women's black overcoat, a women's quilted jacket): with 60 the
 * whole coat class returned "nothing close", because confirmed same-kind
 * pieces that a member reads as clear dupes — a Wool Cashmere Short Wrap
 * Coat, a Wool Blend Short Coat — score 50-58 after the gating. The kind,
 * department, pattern and contradiction rules (which never moved) are what
 * reject unrelated pieces; 50 lets real look-alikes through while everything
 * uncapped-and-unconfirmed still sits below the line via UNCONFIRMED_CAP.
 */
export const MIN_DUPE_SIMILARITY = 50;

/** At or above this a match is "identical" and its line says "Same ...".
 * Still to be observed on a real same-piece hunt; 90 keeps "Same" for rows
 * that share the kind, the pattern, the colour and the fabric. */
export const IDENTICAL_SIMILARITY = 90;

/**
 * The highest score a row can get when the matcher cannot confirm it is the
 * same garment, or its own description contradicts the hunt. Just under
 * MIN_DUPE_SIMILARITY, so it is never shown and never counts as "close in
 * the catalogue" for refunds. The five reasons are listed on judgeCandidate.
 * Colour and a detail or two are not enough to call a piece a look-alike.
 */
const UNCONFIRMED_CAP = MIN_DUPE_SIMILARITY - 1;

/** The product columns this module reads. `gender` and `attire` are optional
 * so rows from a client without those columns still rank. */
export type MatchableProduct = {
  title: string;
  description: string | null;
  category: string;
  gender?: string | null;
  attire?: string[] | null;
};

export type ShopperGender = "Male" | "Female";
type ProductGender = ShopperGender | "Unisex";
type LengthBucket = "short" | "mid" | "long";
type Kind = Exclude<GarmentType, "other">;

/** Lowercase, apostrophes unified, hyphens and punctuation to spaces. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Garment kind
// ---------------------------------------------------------------------------

/** Words that name each garment kind. Matched as whole words, plural allowed. */
const KIND_PHRASES: Record<Kind, string[]> = {
  coat: [
    "coat",
    "overcoat",
    "topcoat",
    "peacoat",
    "pea coat",
    "car coat",
    "wrap coat",
    "cocoon coat",
    "duffle coat",
    "duffel coat",
    "greatcoat",
    "cape",
  ],
  "trench coat": ["trench", "trench coat", "mac", "mac coat", "mackintosh"],
  blazer: [
    "blazer",
    "suit jacket",
    "sport coat",
    "sports coat",
    "tuxedo jacket",
    "dinner jacket",
    "tailored jacket",
  ],
  jacket: [
    "jacket",
    "bomber",
    "shacket",
    "overshirt",
    "harrington",
    "coverall",
    "chore coat",
    "barn coat",
    "shirt jacket",
  ],
  "denim jacket": ["denim jacket", "jean jacket", "trucker", "trucker jacket"],
  "leather jacket": ["leather jacket", "biker", "biker jacket", "moto jacket"],
  puffer: ["puffer", "puffer jacket", "down jacket", "down coat", "liner", "padded jacket"],
  parka: ["parka", "anorak", "raincoat", "rain coat", "rain jacket", "hooded coat", "mod coat"],
  vest: ["vest", "gilet", "waistcoat"],
  "athletic jacket": [
    "track jacket",
    "track top",
    "windbreaker",
    "windrunner",
    "fleece",
    "half zip",
    "quarter zip",
    "softshell",
    "training jacket",
    "running jacket",
  ],
  "t-shirt": ["t shirt", "tee", "tshirt", "henley"],
  shirt: ["shirt", "button down", "button up", "oxford shirt"],
  blouse: ["blouse"],
  // "jersey" only as the LAST garment word: "Jersey Tailored Jacket" is a jacket.
  top: ["top", "tunic", "crop top", "jersey"],
  "tank top": ["tank", "tank top", "cami", "camisole", "vest top"],
  sweater: [
    "sweater",
    "jumper",
    "pullover",
    "knit",
    "crew",
    "crewneck",
    "crew neck",
    "turtleneck",
    "rollneck",
  ],
  cardigan: ["cardigan"],
  sweatshirt: ["sweatshirt", "hoodie", "hooded sweatshirt"],
  polo: ["polo", "polo shirt"],
  bodysuit: ["bodysuit"],
  jeans: ["jeans", "jean", "skinny"],
  trousers: ["trouser", "pant", "chino", "slacks"],
  skirt: ["skirt", "skort"],
  // "short" only wins as the LAST garment word ("Performance Chino Short");
  // in "Short Wrap Coat" the head noun is the coat.
  shorts: ["shorts", "short"],
  leggings: ["legging"],
  joggers: ["jogger", "sweatpant", "track pant", "trackpants"],
  dress: ["dress", "gown", "shirtdress"],
  jumpsuit: ["jumpsuit", "romper", "playsuit", "overalls", "boilersuit"],
  // Sport-shoe words and unambiguous sneaker model names. A bare "Shoes"
  // stays unknown: it could be a loafer as easily as a sneaker.
  sneakers: [
    "sneaker",
    "trainer",
    "running shoe",
    "basketball shoe",
    "racing shoe",
    "trail shoe",
    "skate shoe",
    "golf shoe",
    "workout shoe",
    "training shoe",
    "tennis shoe",
    "cheerleading shoe",
    "air max",
    "air force 1",
    "air jordan",
    "dunk",
    "cortez",
    "huarache",
  ],
  heels: ["heel", "pump", "stiletto"],
  boots: ["boot", "bootie", "booties"],
  flats: ["flat", "ballerina", "ballet flat"],
  sandals: ["sandal", "slide", "espadrille", "mule"],
  loafers: ["loafer", "moccasin", "brogue", "derby"],
  tote: ["tote", "tote bag", "shopper"],
  "shoulder bag": ["shoulder bag", "hobo", "baguette"],
  "crossbody bag": [
    "crossbody",
    "cross body",
    "crossbody bag",
    "messenger",
    "camera bag",
    "belt bag",
    "bum bag",
    "fanny pack",
    "sling",
    "sling bag",
  ],
  clutch: ["clutch", "pouch", "minaudiere", "evening bag"],
  backpack: ["backpack", "rucksack"],
  "top-handle bag": [
    "top handle",
    "top handle bag",
    "satchel",
    "vanity case",
    "bowling bag",
    "bowler bag",
  ],
  necklace: ["necklace", "pendant", "choker"],
  // A bare "stud" only as the LAST garment word of a NAME, never after a
  // decoration word and never in a description (STUD_AS_DECORATION_RE,
  // kindHits): "Cowboy Boot Single Stud" is an earring, "Stud Detail Boots"
  // are boots, "riveted studs ... spiked bracelet" is a bracelet.
  earrings: ["earring", "hoop", "stud earring", "stud"],
  bracelet: ["bracelet", "bangle"],
  ring: ["ring", "signet ring"],
  belt: ["belt"],
  hat: ["hat", "cap", "beanie", "beret", "fedora", "visor"],
  scarf: ["scarf", "scarves", "shawl", "bandana"],
  sunglasses: ["sunglasses", "eyewear"],
  watch: ["watch"],
  socks: ["sock", "knee high"],
  gloves: ["glove", "mitten"],
};

const KIND_MATCHERS = (Object.entries(KIND_PHRASES) as [Kind, string[]][]).flatMap(
  ([kind, phrases]) =>
    phrases.map((phrase) => ({
      kind,
      phrase,
      length: phrase.length,
      re: new RegExp(`\\b${escapeRegExp(phrase)}(?:s|es)?\\b`, "g"),
    })),
);

type KindHit = { kind: Kind; start: number; end: number; length: number };

/** A bare "stud" names the piece only in a product NAME, and not after a
 * word that makes it a decoration ("Riveted Stud Cuff"). In prose it is
 * almost always a decoration ("riveted studs ... the classic spiked
 * bracelet"), so a description must say "stud earring". */
const STUD_AS_DECORATION_RE = /\b(riveted|rivet|spiked|spike|pyramid|metal|cone|studded|stud)\s+$/;

function kindHits(text: string, source: "name" | "description" = "name"): KindHit[] {
  const hits: KindHit[] = [];
  for (const { kind, phrase, length, re } of KIND_MATCHERS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (
        phrase === "stud" &&
        (source === "description" || STUD_AS_DECORATION_RE.test(text.slice(0, m.index)))
      ) {
        continue;
      }
      hits.push({ kind, start: m.index, end: m.index + m[0].length, length });
    }
  }
  return hits;
}

/** Modifiers that turn a generic coat or jacket into a more specific kind. A
 * "Fleece Coat" is a fleece, a "Down Jacket" a puffer, whatever the head noun
 * says. Checked in this order. */
const KIND_MODIFIERS: Array<{ appliesTo: Kind[]; re: RegExp; unless?: RegExp; kind: Kind }> = [
  {
    appliesTo: ["jacket", "coat", "parka"],
    re: /\b(track|tracksuit|track suit|windbreaker|windrunner|fleece|soccer|football|basketball|golf|tennis|running|training|sportswear|dri fit|therma fit|anthem|gym|yoga|workout)\b/,
    kind: "athletic jacket",
  },
  {
    appliesTo: ["jacket", "coat", "parka"],
    re: /\b(puffer|pufftech|padded|padding|quilted|insulated)\b|(?<!button )\bdown\b/,
    kind: "puffer",
  },
  {
    appliesTo: ["jacket", "coat"],
    re: /\b(rain|raincoat|waterproof|water repellent)\b/,
    kind: "parka",
  },
  // A "Trench Jacket" is a short trench, not a casual jacket.
  { appliesTo: ["jacket"], re: /\btrench\b/, kind: "trench coat" },
  { appliesTo: ["jacket"], re: /\b(denim|jean|trucker)\b/, kind: "denim jacket" },
  { appliesTo: ["jacket"], re: /\b(leather|suede|biker|moto)\b/, kind: "leather jacket" },
  // "Tailored" makes a buttoned jacket a blazer, but a "Tailored Zip Jacket"
  // is still a zip jacket.
  {
    appliesTo: ["jacket"],
    re: /\b(tailored|suit|suiting|tuxedo)\b/,
    unless: /\bzip\b/,
    kind: "blazer",
  },
];

function applyModifiers(kind: Kind, text: string): Kind {
  for (const modifier of KIND_MODIFIERS) {
    if (!modifier.appliesTo.includes(kind) || !modifier.re.test(text)) continue;
    if (modifier.unless?.test(text)) continue;
    return modifier.kind;
  }
  return kind;
}

/** The title before the first "|": the product's own name. What follows is
 * a colourway or size ("| Trench Coat Khaki", "| Men's Navy/Birch"). */
function nameHead(title: string): string {
  return title.split("|")[0] ?? title;
}

/** Text for kind reading: without a sleeve length ("Short-Sleeve Boxy
 * T-Shirt" is a t-shirt, not shorts) or a brand that spells a garment
 * ("Jean Paul Gaultier" is not jeans). */
function forKindReading(text: string): string {
  return normalise(text)
    .replace(/\b(short|long) sleeve[sd]?\b/g, " ")
    .replace(/\bjean paul\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The product name for kind reading: the name head (see forKindReading). */
function productName(title: string): string {
  return forKindReading(nameHead(title));
}

/** The name without a "with"/"in" clause ("Mod Coat with Liner Vest", "Shirt
 * in Linen"): the garment is named before it. */
function withoutClause(name: string): string {
  return name.split(/\s(?:with|in)\s/)[0]?.trim() ?? "";
}

/** A garment kind, and whether the product NAME said so (strong) or only the
 * description's first sentence did (weak: it can confirm a match, never rule
 * one out). */
type KindReading = { kind: Kind | null; fromName: boolean };

/** In Jewelry a bare "Chain" ("Wheat Chain", "Herringbone Chain") is a
 * necklace; elsewhere ("Quilted Chain Bag") it is a strap. Catalogue rows
 * only (see readGarmentType), and never a chain worn elsewhere on the body. */
const JEWELLERY_CHAIN_RE = /\bchains?\b/;
const NOT_A_NECK_CHAIN_RE =
  /\b(anklets?|ankle|body|belly|waist|ear|cuffs?|hair|bracelets?|wrist)\b/;

/** The category each garment kind belongs to. A kind read from a row's name
 * that belongs to another category ("Cortez Bag" reads as a sneaker in Bags)
 * is a brand or model word, not the garment: it stays weak and can never rule
 * the row out. */
const KIND_HOME_CATEGORY: Record<Kind, string> = {
  coat: "outerwear",
  "trench coat": "outerwear",
  blazer: "outerwear",
  jacket: "outerwear",
  "denim jacket": "outerwear",
  "leather jacket": "outerwear",
  puffer: "outerwear",
  parka: "outerwear",
  vest: "outerwear",
  "athletic jacket": "outerwear",
  "t-shirt": "tops",
  shirt: "tops",
  blouse: "tops",
  top: "tops",
  "tank top": "tops",
  sweater: "tops",
  cardigan: "tops",
  sweatshirt: "tops",
  polo: "tops",
  bodysuit: "tops",
  jeans: "bottoms",
  trousers: "bottoms",
  skirt: "bottoms",
  shorts: "bottoms",
  leggings: "bottoms",
  joggers: "bottoms",
  dress: "dresses",
  jumpsuit: "dresses",
  sneakers: "shoes",
  heels: "shoes",
  boots: "shoes",
  flats: "shoes",
  sandals: "shoes",
  loafers: "shoes",
  tote: "bags",
  "shoulder bag": "bags",
  "crossbody bag": "bags",
  clutch: "bags",
  backpack: "bags",
  "top-handle bag": "bags",
  necklace: "jewelry",
  earrings: "jewelry",
  bracelet: "jewelry",
  ring: "jewelry",
  belt: "accessories",
  hat: "accessories",
  scarf: "accessories",
  sunglasses: "accessories",
  watch: "accessories",
  socks: "accessories",
  gloves: "accessories",
};

/**
 * The garment kind of a CATALOGUE row (`category` given) or of a name read
 * for the member's photo (no `category`). The chain-as-necklace rule and the
 * category check apply to catalogue rows only: the photographed piece's kind
 * comes from the vision read, and an "other" read means it saw none of the
 * listed kinds, so a "Gold paperclip chain anklet" must not become a necklace
 * search.
 */
function readGarmentType(
  title: string,
  description?: string | null,
  category?: string,
): KindReading {
  const fullName = productName(title);
  const rowCategory = category?.toLowerCase();
  // The clause-free name first; when that names nothing (a name like "Harris
  // Reed In Good Hands Beaded Gemstone Necklace"), the whole name head.
  for (const name of [withoutClause(fullName), fullName]) {
    const nameHits = kindHits(name);
    if (nameHits.length === 0) continue;
    const head = nameHits.reduce((best, hit) =>
      hit.end > best.end || (hit.end === best.end && hit.length > best.length) ? hit : best,
    );
    const kind = applyModifiers(head.kind, name);
    const atHome = !rowCategory || KIND_HOME_CATEGORY[kind] === rowCategory;
    return { kind, fromName: atHome };
  }
  if (
    rowCategory === "jewelry" &&
    JEWELLERY_CHAIN_RE.test(fullName) &&
    !NOT_A_NECK_CHAIN_RE.test(fullName)
  ) {
    return { kind: "necklace", fromName: true };
  }
  if (!description) return { kind: null, fromName: false };
  const firstSentence = forKindReading(description.split(/[.;](?:\s|$)/)[0] ?? "");
  const descHits = kindHits(firstSentence, "description");
  if (descHits.length === 0) return { kind: null, fromName: false };
  const first = descHits.reduce((best, hit) =>
    hit.start < best.start || (hit.start === best.start && hit.length > best.length) ? hit : best,
  );
  return { kind: applyModifiers(first.kind, firstSentence), fromName: false };
}

/**
 * The garment kind a product title names, or null when it names none. The
 * head noun is the LAST garment word in the name (a "Shirt Jacket" is a
 * jacket); at the same position the longer phrase wins (a "Trench Coat" is a
 * trench coat, not a coat). When the name has no garment word, the first one
 * in the description's first sentence is used instead.
 */
export function classifyGarmentType(
  title: string,
  description?: string | null,
  category?: string,
): Kind | null {
  return readGarmentType(title, description, category).kind;
}

/** Kinds close enough to share partial credit, not a rule-out. Symmetric. */
const RELATED_KIND_PAIRS: Array<[Kind, Kind]> = [
  ["coat", "trench coat"],
  ["blazer", "jacket"],
  ["jacket", "denim jacket"],
  ["jacket", "leather jacket"],
  ["puffer", "parka"],
  ["athletic jacket", "sweatshirt"],
  ["t-shirt", "top"],
  ["t-shirt", "polo"],
  ["shirt", "blouse"],
  ["blouse", "top"],
  ["top", "tank top"],
  ["top", "bodysuit"],
  ["sweater", "cardigan"],
  ["sweater", "sweatshirt"],
  ["leggings", "joggers"],
  ["heels", "sandals"],
  ["sandals", "flats"],
  ["flats", "loafers"],
  ["tote", "shoulder bag"],
  ["tote", "top-handle bag"],
  ["shoulder bag", "crossbody bag"],
  ["shoulder bag", "top-handle bag"],
];

function kindsRelated(a: Kind, b: Kind): boolean {
  return RELATED_KIND_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** What a kind reads as when the text says nothing about formality. */
const KIND_FORMALITY: Partial<Record<Kind, Formality>> = {
  coat: "smart",
  "trench coat": "smart",
  blazer: "smart",
  jacket: "casual",
  "denim jacket": "casual",
  "leather jacket": "casual",
  puffer: "casual",
  parka: "casual",
  vest: "casual",
  "athletic jacket": "athletic",
  "t-shirt": "casual",
  shirt: "smart",
  blouse: "smart",
  top: "casual",
  "tank top": "casual",
  sweater: "casual",
  cardigan: "casual",
  sweatshirt: "casual",
  polo: "casual",
  jeans: "casual",
  trousers: "smart",
  shorts: "casual",
  leggings: "athletic",
  joggers: "athletic",
  sneakers: "casual",
  heels: "smart",
  flats: "casual",
  sandals: "casual",
  loafers: "smart",
};

/** Garment words that read as plural ("these jeans", not "this jeans"). */
const PLURAL_KINDS = new Set<Kind>([
  "jeans",
  "trousers",
  "shorts",
  "leggings",
  "joggers",
  "sneakers",
  "heels",
  "boots",
  "flats",
  "sandals",
  "loafers",
  "earrings",
  "sunglasses",
  "socks",
  "gloves",
]);

// ---------------------------------------------------------------------------
// Formality
// ---------------------------------------------------------------------------

const ATHLETIC_RE =
  /\b(track|tracksuits?|track suits?|training|running|gym|yoga|workout|sportswear|sports?|soccer|football|basketball|golf|tennis|athletic|activewear|dri fit|therma fit|fleece|joggers?|sweatpants?|windrunner|windbreaker|hoodie|sweat wicking|moisture wicking)\b/;
const FORMAL_RE =
  /\b(tuxedo|eveningwear|evening wear|evening gown|evening dress|gown|black tie|formal|suiting|suit|double breasted|lapels?|sequin(?:s|ed)?)\b/;
const SMART_RE =
  /\b(tailored|tailoring|wool|cashmere|merino|tweed|boucle|crepe|structured|pleated|polish|polished|refined|elegant|business|office|single breasted|chester|overcoat|trench|blazer|silk|satin|camel hair)\b/;
/** Fit words ("relaxed", "oversized", "slouchy") describe the cut, not the
 * register, so they are deliberately not casual markers: a "Relaxed Long
 * Coat" can be smart. Jersey is not in this list either: it leans casual
 * through JERSEY_RE in productFormalities, after any explicit register in the
 * description and never for tailoring (TAILORED_KINDS). */
const CASUAL_RE =
  /\b(utility|workwear|chore|denim|canvas|corduroy|cargo|distressed|everyday|casual|washed|lounge|t shirt|tee)\b/;

/** "Tennis" is a jewellery style (a tennis bracelet, tennis earrings), not
 * a sport, when the copy is about jewellery. */
const JEWELLERY_RE =
  /\b(earrings?|bracelets?|necklaces?|chains?|chokers?|pendants?|rings?|bangles?|jewel(?:le)?ry)\b/;

/** How dressed-up a piece of copy reads: athletic wins outright (it is the
 * register that must never leak into a tailored search), then the dressiest
 * marker present. Null when the copy says nothing either way. Never "not
 * applicable": that is only ever the vision read's answer. */
export function inferFormality(text: string): RankedFormality | null {
  let t = normalise(text).replace(/\bsports? coats?\b/g, " ");
  if (JEWELLERY_RE.test(t)) t = t.replace(/\btennis\b/g, " ");
  if (ATHLETIC_RE.test(t)) return "athletic";
  if (FORMAL_RE.test(t)) return "formal";
  if (SMART_RE.test(t)) return "smart";
  if (CASUAL_RE.test(t)) return "casual";
  return null;
}

/** The formalities that sit on a scale ("not applicable" does not). */
type RankedFormality = Exclude<Formality, "not applicable">;

const FORMALITY_LEVEL: Record<RankedFormality, number> = {
  formal: 3,
  smart: 2,
  casual: 1,
  athletic: 0,
};

/** Categories whose pieces are never filtered or scored on formality: a bag,
 * a necklace or a hat goes with any register. */
const NO_FORMALITY_CATEGORIES = new Set(["jewelry", "bags", "accessories"]);

/** Categories never matched on pattern: in jewellery "herringbone" is a chain
 * style and "solid gold" a metal, not prints. */
const NO_PATTERN_CATEGORIES = new Set(["jewelry"]);

/** products.attire values (src/constants/attire.ts) as formality. */
const ATTIRE_FORMALITY: Record<string, RankedFormality> = {
  Formal: "formal",
  Evening: "formal",
  "Business Professional": "formal",
  "Business Casual": "smart",
  "Smart Casual": "smart",
  Casual: "casual",
  Athletic: "athletic",
};

/** Where a product's register reading came from. Only "attire" and "name"
 * may rule a row out; only "description" may cap it (judgeCandidate); a
 * "kind-default" (our own assumption, "a sandal is usually casual") only
 * scores. */
type FormalitySource = "attire" | "name" | "description" | "kind-default" | "none";

/** Kinds that are tailoring or shirting whatever the fabric: a blazer, suit
 * jacket, tailored jacket, coat, button shirt or blouse in jersey is still
 * dressed (the Uniqlo "Super Non-Iron Jersey Slim Shirt" is a business
 * shirt). Jersey only leans dresses, tops and trousers casual. */
const TAILORED_KINDS = new Set<Kind>(["blazer", "coat", "trench coat", "shirt", "blouse"]);

const JERSEY_RE = /\bjersey\b/;

/**
 * How dressed-up a product reads, where that reading came from, and whether
 * it is strong enough to rule the row out.
 *
 * In order: the admin's attire tag; a sports garment named in the NAME (a
 * track jacket); a register word in the name; an explicit smart or formal
 * word in the description ("a men's business jacket"); jersey, which leans
 * casual (from the name: strong; from the description: weak) unless the kind
 * is tailoring; any other register word in the description; and last our own
 * kind default, which only scores.
 */
function productFormalities(
  product: MatchableProduct,
  kind: KindReading,
): { levels: RankedFormality[]; strong: boolean; source: FormalitySource } {
  const fromAttire = (product.attire ?? [])
    .map((a) => ATTIRE_FORMALITY[a])
    .filter((f): f is RankedFormality => !!f);
  // The admin's attire tag is authoritative when there is one.
  if (fromAttire.length > 0) {
    return { levels: [...new Set(fromAttire)], strong: true, source: "attire" };
  }

  const kindDefault = kind.kind ? KIND_FORMALITY[kind.kind] : undefined;
  // A sports garment named in the title ("Track Jacket", "Joggers") is a
  // strong athletic signal.
  if (kindDefault === "athletic") {
    return {
      levels: ["athletic"],
      strong: kind.fromName,
      source: kind.fromName ? "name" : "description",
    };
  }
  const name = nameHead(product.title);
  const fromName = inferFormality(name);
  if (fromName) return { levels: [fromName], strong: true, source: "name" };

  const description = product.description ?? "";
  const fromDescription = inferFormality(description);
  // An explicit register in the description beats a jersey lean: a dressy
  // word ("a men's business jacket") and, like everywhere else, a sporty one
  // (the Nike Mad 90 "long-sleeve jersey ... represented soccer" is
  // sportswear, never a smart top).
  if (
    fromDescription === "formal" ||
    fromDescription === "smart" ||
    fromDescription === "athletic"
  ) {
    return { levels: [fromDescription], strong: false, source: "description" };
  }
  // Jersey is a casual fabric for a dress, a top or trousers ("Cotton Jersey
  // Rugby Dress"), never for tailoring; an explicit dressy word above wins
  // over it (the Muji "Stretch Jersey Jacket" is "a men's business jacket").
  const tailored = kind.kind !== null && TAILORED_KINDS.has(kind.kind);
  if (!tailored && JERSEY_RE.test(normalise(name))) {
    return { levels: ["casual"], strong: true, source: "name" };
  }
  if (!tailored && JERSEY_RE.test(normalise(description))) {
    return { levels: ["casual"], strong: false, source: "description" };
  }
  if (fromDescription) return { levels: [fromDescription], strong: false, source: "description" };
  // Our own assumption ("a jacket is usually casual"): it scores but never
  // rules out or caps. The Muji "Breathable Jacket" is a tailored jacket.
  if (kindDefault && kindDefault !== "not applicable") {
    return { levels: [kindDefault], strong: false, source: "kind-default" };
  }
  return { levels: [], strong: false, source: "none" };
}

// ---------------------------------------------------------------------------
// Pattern, colour, length, fabric
// ---------------------------------------------------------------------------

const PATTERN_RES: Array<[Pattern, RegExp]> = [
  ["striped", /\b(stripes?|striped|pinstripes?|pinstriped|pin stripes?|breton|striping)\b/],
  // A bare "check" is a verb ("Stick? Check."); a check PATTERN is named as one.
  [
    "plaid",
    /\b(plaid|tartan|checked|checkered|micro check|gingham|windowpane|glen check|prince of wales|check (?:pattern|print|weave|wool|cotton|flannel|tweed|shirt|blazer|jacket|coat|trousers?|skirt))\b/,
  ],
  ["herringbone", /\bherringbone\b/],
  ["houndstooth", /\b(houndstooth|dogtooth|pied de poule)\b/],
  // "flower-scented air" is not a print; a flower PRINT is named as one.
  ["floral", /\b(floral|florals|flowered|ditsy|botanical print|flower print)\b/],
  ["polka dot", /\b(polka|polka dots?|dotted|dot print|spot print)\b/],
  ["animal print", /\b(leopard|zebra|snakeskin|snake print|python|cheetah|animal print)\b/],
  ["camouflage", /\b(camo|camouflage)\b/],
  ["colour block", /\b(colou?r ?block|colou?r ?blocked|two tone)\b/],
  // "a graphic shape" is not a print; a graphic PRINT or TEE is.
  ["graphic", /\b(graphic (?:print|tee|t shirt|logo)|slogan)\b/],
];

/** The pattern a piece of copy names, "solid" when it says plain/solid, or
 * null when it says nothing (which is not the same as solid). */
export function detectPattern(text: string): Pattern | null {
  const t = normalise(text);
  for (const [pattern, re] of PATTERN_RES) if (re.test(t)) return pattern;
  if (/\b(solid|plain)\b/.test(t)) return "solid";
  return null;
}

/** Colour-card names that contain a print word but are plain colours. */
const COLOUR_NAMES_NOT_PRINTS =
  /\b(floral white|snow leopard|python green|camo green|leopard grey|zebra grey)\b/g;

/**
 * The print a TITLE names, colourway included ("| Pale Khaki Plaid"), where
 * shops name it. Colour-card names are not prints ("| Floral White"), and a
 * "Check" in the colourway is a check print ("| Black Watch Check"), though
 * a bare "check" in prose is not (see PATTERN_RES).
 */
function titlePrint(title: string): Pattern | null {
  const cleaned = normalise(title).replace(COLOUR_NAMES_NOT_PRINTS, " ");
  const named = detectPattern(cleaned);
  if (named) return named;
  const colourway = title.split("|").slice(1).join(" ");
  return /\bchecks?\b/i.test(colourway) ? "plaid" : null;
}

const COLOUR_FAMILIES: Record<string, string[]> = {
  black: ["black", "onyx", "ebony", "noir"],
  white: ["white", "ivory", "cream", "ecru", "alabaster", "chalk", "bone", "snow"],
  beige: [
    "beige",
    "camel",
    "khaki",
    "tan",
    "taupe",
    "sand",
    "oat",
    "oatmeal",
    "nude",
    "biscuit",
    "biscotti",
    "beech",
    "toffee",
    "caramel",
    "wheat",
    "fawn",
    "mushroom",
    "buff",
  ],
  brown: [
    "brown",
    "chocolate",
    "cocoa",
    "coffee",
    "mocha",
    "espresso",
    "chestnut",
    "cognac",
    "walnut",
    "umber",
    "tobacco",
  ],
  grey: ["grey", "gray", "charcoal", "heather", "heathered", "slate", "graphite", "ash", "pewter"],
  blue: ["blue", "navy", "cobalt", "indigo", "azure", "cornflower", "midnight", "sapphire"],
  green: ["green", "olive", "sage", "emerald", "moss", "lichen", "mint", "jade", "teal"],
  red: [
    "red",
    "burgundy",
    "wine",
    "maroon",
    "oxblood",
    "berry",
    "cherry",
    "crimson",
    "scarlet",
    "brick",
    "claret",
    "bordeaux",
  ],
  pink: ["pink", "blush", "rose", "fuchsia", "magenta", "salmon", "mauve"],
  purple: ["purple", "lilac", "lavender", "violet", "plum", "aubergine"],
  yellow: ["yellow", "mustard", "butter", "lemon", "canary", "saffron"],
  orange: ["orange", "coral", "rust", "terracotta", "tangerine", "apricot", "peach"],
  metallic: ["gold", "silver", "bronze", "metallic", "copper"],
};

const COLOUR_FAMILY_OF = new Map<string, string>(
  Object.entries(COLOUR_FAMILIES).flatMap(([family, words]) =>
    words.map((word) => [word, family] as const),
  ),
);

/** Recognised colour words in the copy, in order of appearance. */
function colourWords(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((word) => COLOUR_FAMILY_OF.has(word));
}

function lengthBucketOf(text: string): LengthBucket | null {
  const t = normalise(text)
    .replace(/\b(short|long) sleeve[sd]?\b/g, " ")
    .replace(/\blong lasting\b/g, " ");
  const found = new Set<LengthBucket>();
  if (/\b(cropped|crop|short|hip length|waist length|mini)\b/.test(t)) found.add("short");
  if (/\b(mid thigh|thigh length|knee length|knee|midi|three quarter)\b/.test(t)) found.add("mid");
  if (/\b(long|longline|maxi|full length|ankle length|floor length|duster)\b/.test(t)) {
    found.add("long");
  }
  return found.size === 1 ? [...found][0] : null;
}

const SPEC_LENGTH_BUCKET: Record<GarmentLength, LengthBucket | null> = {
  cropped: "short",
  hip: "short",
  "mid-thigh": "mid",
  knee: "mid",
  midi: "mid",
  maxi: "long",
  "not applicable": null,
};

const LENGTH_INDEX: Record<LengthBucket, number> = { short: 0, mid: 1, long: 2 };

const FABRIC_FAMILIES: Record<string, string[]> = {
  wool: [
    "wool",
    "cashmere",
    "merino",
    "alpaca",
    "mohair",
    "tweed",
    "boucle",
    "felt",
    "flannel",
    "melton",
    "rewool",
  ],
  cotton: ["cotton", "twill", "canvas", "poplin", "chino", "gabardine", "broadcloth", "seersucker"],
  denim: ["denim", "chambray"],
  leather: ["leather", "suede", "nappa", "patent"],
  linen: ["linen", "hemp", "ramie"],
  silk: ["silk", "satin", "charmeuse", "chiffon", "georgette", "organza"],
  synthetic: ["polyester", "nylon", "ripstop", "polyamide", "softshell", "technical"],
  knit: ["knit", "knitted", "jersey", "ribbed", "ponte"],
  fleece: ["fleece", "sherpa", "boa", "pile", "polartec"],
  corduroy: ["corduroy", "cord"],
  down: ["down", "padded", "padding", "insulated", "insulation", "puffer"],
  viscose: ["viscose", "rayon", "modal", "lyocell", "tencel", "cupro"],
};

const FABRIC_FAMILY_OF = new Map<string, string>(
  Object.entries(FABRIC_FAMILIES).flatMap(([family, words]) =>
    words.map((word) => [word, family] as const),
  ),
);

function fabricFamilies(text: string): Set<string> {
  const words = normalise(text)
    .replace(/\bbutton (down|up)\b/g, " ")
    .split(" ");
  const families = new Set<string>();
  for (const word of words) {
    const family = FABRIC_FAMILY_OF.get(word);
    if (family) families.add(family);
  }
  return families;
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

const DETAIL_STOPWORDS = new Set([
  "the",
  "and",
  "with",
  "for",
  "detail",
  "details",
  "style",
  "look",
  "fit",
  "front",
  "shape",
]);

function stem(word: string): string {
  return word.length > 4 ? word.replace(/(ing|ed|es|s)$/, "") : word;
}

/** A detail ("notch lapels") as the word stems a product must mention. */
function detailStems(detail: string): string[] {
  return normalise(detail)
    .split(" ")
    .filter((w) => w.length >= 3 && !DETAIL_STOPWORDS.has(w))
    .map(stem);
}

function mentionsAll(haystack: string, stems: string[]): boolean {
  return stems.every((s) => new RegExp(`\\b${escapeRegExp(s)}`).test(haystack));
}

// ---------------------------------------------------------------------------
// Closure
// ---------------------------------------------------------------------------

const CLOSURE_RES: Array<[Closure, RegExp]> = [
  ["double-breasted", /\bdouble breasted\b/],
  ["single-breasted", /\bsingle breasted\b/],
  ["zip", /\b(zip|zips|zipped|zipper|zippers|zip up|full zip|half zip|quarter zip)\b/],
  ["belted", /\b(belt|belted|belts|wrap|self tie|tie waist)\b/],
  ["toggle", /\btoggles?\b/],
  ["snap", /\b(snaps?|press studs?)\b/],
  ["pullover", /\b(pullover|pull on)\b/],
  ["open front", /\b(open front|edge to edge)\b/],
];

/** Every fastening the copy names ("double-breasted", "full-zip"...). */
function closuresOf(text: string): Set<Closure> {
  const t = normalise(text);
  return new Set(CLOSURE_RES.filter(([, re]) => re.test(t)).map(([closure]) => closure));
}

// ---------------------------------------------------------------------------
// Gender
// ---------------------------------------------------------------------------

const WOMENS_RE = /\bwomen'?s\b|\bladies\b/;
const MENS_RE = /\bmen'?s\b/;

type GenderedProduct = { title: string; description: string | null; gender?: string | null };

/** "for women" / "for men" as a claim about the piece; a store list ("for
 * women, men, kids and babies") is not one. */
const FOR_WOMEN_RE = /\bfor women\b/;
const FOR_MEN_RE = /\bfor men\b/;
const STORE_LIST_RE = /\bfor (?:wo)?men (?:and )?(?:wo)?men\b/g;
const SIZING_NOTE_RE = /\b(?:wo)?men'?s siz(?:e|es|ing)\b/g;

/**
 * The department a piece of text claims, or null when it claims none or
 * both. An explicit claim ("women's", "men's cut", "for women", "for men")
 * beats "unisex". "Unisex" beats only a sizing note: "this unisex product
 * uses men's sizing" is unisex, while "available in women's sizes only",
 * with no "unisex", is still a women's claim. Store boilerplate such as
 * "for women, men, kids" is not a claim.
 */
function departmentIn(text: string): ProductGender | null {
  const normalised = normalise(text).replace(STORE_LIST_RE, " ");
  const unisex = /\bunisex\b/.test(normalised);
  const t = unisex ? normalised.replace(SIZING_NOTE_RE, " ") : normalised;
  const womens = WOMENS_RE.test(t) || FOR_WOMEN_RE.test(t);
  const mens = MENS_RE.test(t) || FOR_MEN_RE.test(t);
  if (womens && !mens) return "Female";
  if (mens && !womens) return "Male";
  if (unisex) return "Unisex";
  return null;
}

/** Who a product is cut for, and where that came from. Only the name and the
 * column may rule a row out; a department read from the description only
 * caps it (see judgeCandidate). */
type Department = { gender: ProductGender; from: "name" | "description" | "column" | "none" };

function productDepartment(product: GenderedProduct): Department {
  // The name head only: the colourway after "|" is never read ("| Men's
  // Navy/Birch" is a colour name on a women's dress).
  const fromName = departmentIn(nameHead(product.title));
  if (fromName) return { gender: fromName, from: "name" };
  // An explicit "women's"/"men's" in the description overrides a miscoded
  // column (seeded Muji rows stored as Male say "A women's button-up jacket").
  const fromDescription = departmentIn(product.description ?? "");
  if (fromDescription === "Female" || fromDescription === "Male") {
    return { gender: fromDescription, from: "description" };
  }
  if (product.gender === "Male" || product.gender === "Female") {
    return { gender: product.gender, from: "column" };
  }
  return { gender: "Unisex", from: "none" };
}

/**
 * Who a product is cut for: an explicit "women's" or "men's" in the product
 * NAME (before "|"), else in the description, else the gender column; a row
 * with none of them is Unisex.
 */
export function productGender(product: GenderedProduct): ProductGender {
  return productDepartment(product).gender;
}

/**
 * Whether a product can be shown to someone shopping `gender`: its
 * department (productGender) matches or is Unisex, or its description says
 * "Unisex design", which only ever adds a department.
 */
export function productAllowsGender(product: GenderedProduct, gender: ShopperGender): boolean {
  const department = productGender(product);
  if (department === "Unisex" || department === gender) return true;
  return departmentIn(product.description ?? "") === "Unisex";
}

// ---------------------------------------------------------------------------
// Target + judgement
// ---------------------------------------------------------------------------

export type DupeTarget = {
  category: string;
  kind: Kind | null;
  gender: ShopperGender | null;
  /** Null for jewellery, bags and accessories: never filtered on formality. */
  formality: RankedFormality | null;
  pattern: Pattern | null;
  closure: Closure | null;
  dominantColour: string | null;
  secondaryColours: string[];
  length: LengthBucket | null;
  fabrics: Set<string>;
  details: Array<{ label: string; stems: string[] }>;
};

function asShopperGender(value: string | null | undefined): ShopperGender | null {
  return value === "Male" || value === "Female" ? value : null;
}

/**
 * Everything the matcher compares against, from the vision read when it has
 * the field, else inferred from the name and silhouette tags (attributes
 * stored on post items before the spec existed). Gender: the garment's own
 * fit wins; a unisex or unknown fit falls back to the member's profile.
 */
export function resolveDupeTarget(
  attrs: DupeAttributes,
  profileGender?: string | null,
): DupeTarget {
  const legacyText = `${attrs.name} ${attrs.silhouette_tags.join(" ")}`;

  const kind =
    attrs.garment_type && attrs.garment_type !== "other"
      ? attrs.garment_type
      : // The member's piece: no catalogue-only rules (see readGarmentType).
        classifyGarmentType(attrs.name);

  const nameText = normalise(attrs.name);
  const fitGender: ShopperGender | null =
    attrs.gender_fit === "womenswear"
      ? "Female"
      : attrs.gender_fit === "menswear"
        ? "Male"
        : attrs.gender_fit === undefined && WOMENS_RE.test(nameText) && !MENS_RE.test(nameText)
          ? "Female"
          : attrs.gender_fit === undefined && MENS_RE.test(nameText) && !WOMENS_RE.test(nameText)
            ? "Male"
            : null;

  const readFormality =
    attrs.formality && attrs.formality !== "not applicable" ? attrs.formality : null;
  const kindFormality = kind ? KIND_FORMALITY[kind] : undefined;
  const formality: RankedFormality | null = NO_FORMALITY_CATEGORIES.has(
    attrs.category.toLowerCase(),
  )
    ? null
    : (readFormality ??
      inferFormality(legacyText) ??
      (kindFormality && kindFormality !== "not applicable" ? kindFormality : null));

  // In jewellery "herringbone" is a chain style and "solid gold" a metal, so
  // jewellery is never matched on pattern.
  const pattern = NO_PATTERN_CATEGORIES.has(attrs.category.toLowerCase())
    ? null
    : attrs.pattern && attrs.pattern !== "other"
      ? attrs.pattern
      : detectPattern(legacyText);

  const closure =
    attrs.closure === undefined
      ? ([...closuresOf(legacyText)][0] ?? null)
      : attrs.closure === "not applicable" || attrs.closure === "other"
        ? null
        : attrs.closure;

  const colours = [attrs.primary_color, ...(attrs.colors ?? [])].flatMap(colourWords);
  const uniqueColours = [...new Set(colours)];

  const length =
    attrs.length !== undefined ? SPEC_LENGTH_BUCKET[attrs.length] : lengthBucketOf(legacyText);

  const fabrics = fabricFamilies(attrs.fabric ?? legacyText);

  const detailLabels = [...(attrs.key_details ?? []), ...attrs.silhouette_tags];
  const seen = new Set<string>();
  const details: DupeTarget["details"] = [];
  for (const label of detailLabels) {
    const stems = detailStems(label);
    const key = stems.join(" ");
    if (stems.length === 0 || seen.has(key)) continue;
    seen.add(key);
    details.push({ label: label.trim(), stems });
  }

  return {
    category: attrs.category,
    kind,
    gender: fitGender ?? asShopperGender(profileGender),
    formality,
    pattern,
    closure,
    dominantColour: uniqueColours[0] ?? null,
    secondaryColours: uniqueColours.slice(1),
    length,
    fabrics,
    details,
  };
}

export type CandidateVerdict =
  | { eligible: false; ruledOutBy: "category" | "kind" | "gender" | "formality" | "pattern" }
  | { eligible: true; similarity: number; summary: string };

/** Points per attribute; a perfect match on every attribute the target knows
 * is 100. Attributes the target does not know are left out of the total. */
const WEIGHTS = {
  kind: 30,
  formality: 15,
  pattern: 15,
  colour: 15,
  length: 7,
  fabric: 8,
  closure: 5,
  details: 5,
} as const;

/** At most this many details count toward full detail credit. */
const DETAILS_FOR_FULL_CREDIT = 4;

/** Fabric families that read naturally in a summary ("Same wool coat");
 * the rest ("synthetic", "down") are matched but not named. */
const SUMMARY_FABRICS = new Set([
  "wool",
  "cotton",
  "denim",
  "leather",
  "linen",
  "silk",
  "fleece",
  "corduroy",
]);

function withArticle(noun: string): string {
  if (PLURAL_KINDS.has(noun as Kind)) return noun;
  return /^[aeiou]/.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/**
 * Rules a candidate out, or scores it 0-100 with a one-line summary of what
 * matches.
 *
 * Ruled out, on STRONG signals only (the product name, the admin attire
 * tag, the column): a different category; a different garment kind named in
 * the product name (a related kind, coat and trench coat, only loses
 * points); a different department; a formality two or more steps away
 * (athletic is never formal or smart); a title that names a different
 * pattern. The description never rules a row out.
 *
 * Capped at UNCONFIRMED_CAP, below MIN_DUPE_SIMILARITY (kept, never shown):
 * 1. the garment kind is unknown on either side, or read only from the
 *    description as a different kind (colour and a detail or two could
 *    otherwise score a sports layer as "identical" to a piece we could not
 *    name);
 * 2. the target is patterned and no part of the row's copy names that
 *    pattern;
 * 3. the target is plain and the row's description names a print;
 * 4. the row's description names the other department;
 * 5. the row's description reads two or more registers away (a "track coat
 *    cut for training days" for a formal coat). Our kind defaults never cap.
 */
export function judgeCandidate(target: DupeTarget, product: MatchableProduct): CandidateVerdict {
  if (product.category.toLowerCase() !== target.category.toLowerCase()) {
    return { eligible: false, ruledOutBy: "category" };
  }

  const reading = readGarmentType(product.title, product.description, product.category);
  const kind = reading.kind;
  // A kind read only from the description (or a name word from another
  // category) confirms a match only when it is the SAME kind; anything else
  // it says leaves the kind unconfirmed, never a rule-out or a "related".
  const kindRelation =
    !target.kind || !kind
      ? "unknown"
      : kind === target.kind
        ? "same"
        : !reading.fromName
          ? "unknown"
          : kindsRelated(kind, target.kind)
            ? "related"
            : "different";
  if (kindRelation === "different") return { eligible: false, ruledOutBy: "kind" };

  // Department: a conflict in the name or the column rules the row out; one
  // read from the description caps it, so the row is shown only to the
  // department its copy names.
  let departmentConflict = false;
  if (target.gender && !productAllowsGender(product, target.gender)) {
    if (productDepartment(product).from !== "description") {
      return { eligible: false, ruledOutBy: "gender" };
    }
    departmentConflict = true;
  }

  const formalities = productFormalities(product, reading);
  const targetLevel = target.formality ? FORMALITY_LEVEL[target.formality] : null;
  const formalityDistance =
    targetLevel !== null && formalities.levels.length > 0
      ? Math.min(...formalities.levels.map((f) => Math.abs(FORMALITY_LEVEL[f] - targetLevel)))
      : null;
  if (formalities.strong && formalityDistance !== null && formalityDistance >= 2) {
    return { eligible: false, ruledOutBy: "formality" };
  }
  // The same gap read from the row's own DESCRIPTION caps it: a coat whose
  // copy says "a track coat cut for training days" is never shown to a formal
  // or smart coat hunt. Our kind defaults never cap ("a sandal is usually
  // casual" must not hide plain black sandals from a formal read).
  const formalityConflict =
    formalities.source === "description" && formalityDistance !== null && formalityDistance >= 2;

  const fullText = `${product.title} ${product.description ?? ""}`;
  // The whole title (name and colourway) is read for the print: shops name
  // it there ("| Pale Khaki Plaid", "| Taupe Herringbone"). The description
  // only confirms.
  const titlePattern = titlePrint(product.title);
  const descriptionPattern = detectPattern(product.description ?? "");
  const patternConflict =
    target.pattern !== null &&
    titlePattern !== null &&
    titlePattern !== target.pattern &&
    // A plain target is not contradicted by a title that also says plain.
    !(target.pattern === "solid" && titlePattern === "solid");
  if (patternConflict) return { eligible: false, ruledOutBy: "pattern" };
  const pattern = titlePattern ?? descriptionPattern;
  // A patterned target needs its print named somewhere in the copy; a plain
  // target is capped by a print named in the description (a "cream
  // ditsy-floral top" is not a plain cream top).
  const patternUnconfirmed =
    target.pattern !== null && target.pattern !== "solid" && pattern !== target.pattern;
  const descriptionPrint =
    target.pattern === "solid" &&
    titlePattern === null &&
    descriptionPattern !== null &&
    descriptionPattern !== "solid";

  const haystack = normalise(fullText);
  let earned = 0;
  let possible = 0;
  const score = (weight: number, credit: number | null) => {
    if (credit === null) return;
    possible += weight;
    earned += weight * credit;
  };

  // Garment kind
  score(
    WEIGHTS.kind,
    !target.kind ? null : kindRelation === "same" ? 1 : kindRelation === "related" ? 0.5 : 0,
  );

  // Formality
  score(
    WEIGHTS.formality,
    !target.formality ? null : formalityDistance === 0 ? 1 : formalityDistance === 1 ? 0.5 : 0,
  );

  // Pattern (a print named only in the description earns nothing for a
  // plain target, but is not a rule-out)
  const patternMatched = !!target.pattern && pattern === target.pattern;
  score(
    WEIGHTS.pattern,
    !target.pattern
      ? null
      : patternMatched
        ? 1
        : target.pattern === "solid" && pattern === null
          ? 0.6
          : 0,
  );

  // Colour
  const productColours = new Set(colourWords(fullText));
  const productFamilies = new Set([...productColours].map((c) => COLOUR_FAMILY_OF.get(c)));
  const dominantExact = !!target.dominantColour && productColours.has(target.dominantColour);
  const colourCredit = !target.dominantColour
    ? null
    : dominantExact
      ? 1
      : productFamilies.has(COLOUR_FAMILY_OF.get(target.dominantColour)) ||
          target.secondaryColours.some((c) => productColours.has(c))
        ? 0.5
        : 0;
  score(WEIGHTS.colour, colourCredit);

  // Length
  const length = lengthBucketOf(fullText);
  score(
    WEIGHTS.length,
    !target.length
      ? null
      : !length
        ? 0
        : Math.abs(LENGTH_INDEX[length] - LENGTH_INDEX[target.length]) === 0
          ? 1
          : Math.abs(LENGTH_INDEX[length] - LENGTH_INDEX[target.length]) === 1
            ? 0.5
            : 0,
  );

  // Fabric
  const fabrics = fabricFamilies(fullText);
  const sharedFabric = [...target.fabrics].find((f) => fabrics.has(f)) ?? null;
  score(WEIGHTS.fabric, target.fabrics.size === 0 ? null : sharedFabric ? 1 : 0);

  // Closure
  const productClosures = closuresOf(fullText);
  score(WEIGHTS.closure, !target.closure ? null : productClosures.has(target.closure) ? 1 : 0);

  // Details
  const matchedDetails = target.details.filter((d) => mentionsAll(haystack, d.stems));
  score(
    WEIGHTS.details,
    target.details.length === 0
      ? null
      : Math.min(
          1,
          matchedDetails.length / Math.min(target.details.length, DETAILS_FOR_FULL_CREDIT),
        ),
  );

  const raw = possible === 0 ? 0 : Math.round((100 * earned) / possible);
  const unconfirmed =
    kindRelation === "unknown" ||
    patternUnconfirmed ||
    descriptionPrint ||
    departmentConflict ||
    formalityConflict;
  const similarity = unconfirmed ? Math.min(raw, UNCONFIRMED_CAP) : raw;

  const descriptors = [
    patternMatched && target.pattern !== "solid" ? target.pattern : null,
    dominantExact ? target.dominantColour : null,
    sharedFabric && SUMMARY_FABRICS.has(sharedFabric) ? sharedFabric : null,
  ].filter((d): d is string => !!d);

  let summary: string;
  if (kindRelation === "same" && target.kind && similarity >= IDENTICAL_SIMILARITY) {
    summary = `Same ${[...descriptors, target.kind].join(" ")}`;
  } else if (kindRelation === "same" && target.kind) {
    // Close, not identical: never claim "Same" below the identical line.
    const similar = PLURAL_KINDS.has(target.kind) ? "Similar" : "A similar";
    summary = `${similar} ${[...descriptors, target.kind].join(" ")}`;
  } else if (kindRelation === "related" && kind && target.kind) {
    summary = `${withArticle(kind)} close to your ${target.kind}`;
    summary = summary.charAt(0).toUpperCase() + summary.slice(1);
  } else {
    const parts = [
      dominantExact ? `${target.dominantColour} colour` : null,
      matchedDetails[0] ? `${matchedDetails[0].label} detail` : null,
    ].filter((p): p is string => !!p);
    summary = parts.length > 0 ? `Matches the ${parts.join(" and ")}` : "Close in shape and colour";
  }

  return { eligible: true, similarity, summary };
}

/** The word for the garment in member-facing copy ("this coat"). */
export function garmentNoun(attrs: DupeAttributes): string {
  const kind =
    attrs.garment_type && attrs.garment_type !== "other"
      ? attrs.garment_type
      : // The member's piece: no catalogue-only rules (see readGarmentType).
        classifyGarmentType(attrs.name);
  return kind ?? "piece";
}

/** True for nouns that take "these" ("these jeans"). */
export function isPluralGarmentNoun(noun: string): boolean {
  return PLURAL_KINDS.has(noun as Kind);
}

const DEPARTMENT_WORD: Record<string, string> = { womenswear: "women's", menswear: "men's" };
const FORMALITY_WORD: Record<Formality, string | null> = {
  formal: "formal",
  smart: "smart",
  casual: "casual",
  athletic: "sporty",
  "not applicable": null,
};

/** Values the vision read uses for "none" that must never reach the member
 * ("A women's black not applicable boots"). */
const NOT_A_VALUE = /^(not applicable|n\/?a|none|unknown)$/i;
const LENGTH_PHRASE: Partial<Record<GarmentLength, string>> = {
  cropped: "cropped",
  hip: "hip length",
  "mid-thigh": "mid-thigh length",
  knee: "knee length",
  midi: "midi length",
  maxi: "maxi length",
};
/** Product copy rule: no en or em dashes in member-facing text. Built from
 * code points so the source itself carries none. */
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

/** Closures that read naturally before the garment noun. */
const CLOSURE_ADJECTIVE: Partial<Record<Closure, string>> = {
  "double-breasted": "double-breasted",
  "single-breasted": "single-breasted",
  belted: "belted",
};

/**
 * What the vision read identified, as one plain line for the member ("A
 * women's navy and white striped double-breasted wool coat, knee length,
 * formal"). Only what was identified: nothing is inferred or guessed here.
 */
export function describeIdentification(attrs: DupeAttributes): string {
  const colours =
    attrs.colors && attrs.colors.length > 0
      ? attrs.colors.slice(0, 2).map((c) => c.trim().toLowerCase())
      : [attrs.primary_color.trim().toLowerCase()];
  const pattern =
    attrs.pattern && attrs.pattern !== "solid" && attrs.pattern !== "other" ? attrs.pattern : null;
  const fabric = attrs.fabric?.trim().toLowerCase();
  const noun = garmentNoun(attrs);
  const words = [
    attrs.gender_fit ? DEPARTMENT_WORD[attrs.gender_fit] : null,
    colours.filter((c) => c && !NOT_A_VALUE.test(c)).join(" and "),
    pattern,
    attrs.closure ? CLOSURE_ADJECTIVE[attrs.closure] : null,
    fabric && !NOT_A_VALUE.test(fabric) ? fabric : null,
    noun,
  ]
    .filter((w): w is string => !!w)
    .join(" ")
    .split(" ")
    // "gold" colour + "gold vermeil" fabric reads "gold vermeil", not "gold gold".
    .filter((word, i, all) => i === 0 || word !== all[i - 1])
    .join(" ");
  const tail = [
    attrs.length ? LENGTH_PHRASE[attrs.length] : null,
    attrs.formality ? FORMALITY_WORD[attrs.formality] : null,
  ].filter((w): w is string => !!w);
  // "A pair of women's black boots", never "A women's black boots".
  const article = isPluralGarmentNoun(noun) ? "A pair of" : /^[aeiou]/i.test(words) ? "An" : "A";
  return [`${article} ${words}`, ...tail]
    .join(", ")
    .split(EN_DASH)
    .join(" ")
    .split(EM_DASH)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
