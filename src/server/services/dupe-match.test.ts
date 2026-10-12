import { describe, expect, test } from "bun:test";
import {
  classifyGarmentType,
  describeIdentification,
  detectPattern,
  garmentNoun,
  IDENTICAL_SIMILARITY,
  inferFormality,
  judgeCandidate,
  MIN_DUPE_SIMILARITY,
  productAllowsGender,
  productGender,
  resolveDupeTarget,
  type CandidateVerdict,
  type MatchableProduct,
} from "./dupe-match";
import type { DupeAttributes } from "@/lib/dupe-spec";
import {
  OUTERWEAR_CATALOGUE,
  PINSTRIPE_COAT,
  REREVIEW_CITED_ROWS,
  REREVIEW2_CITED_ROWS,
  REREVIEW3_CITED_ROWS,
  REVIEW_CITED_ROWS,
  SPORTY_ROWS_NAMED_COAT,
  SPORTY_OUTERWEAR,
  type FixtureProductRow,
} from "./dupes.fixtures";

/** True when text carries an en or em dash (banned in member-facing copy). */
function hasDash(text: string): boolean {
  return text.includes(String.fromCharCode(0x2013)) || text.includes(String.fromCharCode(0x2014));
}

/** Would this verdict be shown to the member? */
function qualifies(verdict: CandidateVerdict): boolean {
  return verdict.eligible && verdict.similarity >= MIN_DUPE_SIMILARITY;
}

function ruledOutBy(verdict: CandidateVerdict): string | null {
  return verdict.eligible ? null : verdict.ruledOutBy;
}

const STRIPED_FORMAL_WOMENS_COAT: DupeAttributes = {
  name: "Navy pinstripe double-breasted wool coat",
  category: "Outerwear",
  primary_color: "Navy",
  color_undertone: "Cool",
  silhouette_tags: ["double-breasted", "tailored", "longline"],
  garment_type: "coat",
  gender_fit: "womenswear",
  formality: "formal",
  pattern: "striped",
  colors: ["navy", "white"],
  length: "knee",
  fabric: "wool blend",
  key_details: ["notch lapels", "double-breasted", "flap pockets"],
};

function fixture(id: string): FixtureProductRow {
  const found = [...OUTERWEAR_CATALOGUE, PINSTRIPE_COAT].find((r) => r.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
}

describe("classifyGarmentType", () => {
  const cases: Array<[string, string | null]> = [
    ["Nike Sportswear Windrunner Men's Hooded Jacket", "athletic jacket"],
    ["Nike SB Ishod Track Jacket", "athletic jacket"],
    ["Nike Tour Repel Women's Golf Jacket", "athletic jacket"],
    ["Boa Fleece Coat", "athletic jacket"],
    ["Fleece Full-Zip Jacket", "athletic jacket"],
    ["ReNew Quilted Vest | Coffee Bean", "vest"],
    ["Nike Sportswear Swoosh Series Women's Loose Therma-FIT Hooded Down Vest", "vest"],
    ["The Puffer Bomber | Kalamata", "puffer"],
    ["Reversible Down Short Jacket", "puffer"],
    ["The Cotton Long Trench Coat | Beech", "trench coat"],
    ["The Mac Coat | Beech", "trench coat"],
    ["Wool Cashmere Short Wrap Coat", "coat"],
    ["Technical Wool Overcoat", "coat"],
    ["Labo Men's Mod Coat with Liner Vest", "parka"],
    ["Water Repellent Hooded Coat", "parka"],
    ["Wool Cinched Blazer", "blazer"],
    ["Hemp Blend Twill Tailored Jacket", "blazer"],
    ["Denim Trucker Jacket", "denim jacket"],
    ["The Denim Barrel Jacket | Cocoa", "denim jacket"],
    ["Falcon Jacket, UnReal Leather", "leather jacket"],
    ["Broadcloth Shirt Jacket", "jacket"],
    // A colour name after the pipe is not the garment.
    ["Baggy Chino | Trench Coat Khaki | 30L", "trousers"],
    ["The Classic Shirt in Linen | Trench Coat Khaki", "shirt"],
    ["Long-sleeve Top in Double Stripe", "top"],
    ["Nike Solo Fleece Men's Pullover Hoodie", "sweatshirt"],
    ["Quilted Tote", "tote"],
    ["Sandy Heeled Sandal", "sandals"],
    ["Ailany Dress", "dress"],
    // A vanity case is a top-handle bag.
    ["Quilted vanity case", "top-handle bag"],
    // Real seeded titles the review found misclassified (2026-10-07).
    ["Trench Jacket in Double Cotton", "trench coat"],
    ["Tailored Zip Jacket | Black", "jacket"],
    ['The 7" Slim-Fit Performance Chino Short | Slate Grey', "shorts"],
    ["Linen Shirt Short Sleeve", "shirt"],
    ["Statement outer layer", null],
    // Real seeded titles that read as "no garment" before (fix round 1): an
    // unknown kind can never qualify, so plain vocabulary gaps cost recall.
    ["Tatum 4 Basketball Shoes", "sneakers"],
    ["Nike Air Force 1 '07", "sneakers"],
    ['Air Jordan 6 Retro "Black and White"', "sneakers"],
    ["The Selvedge Slim-Fit Jean | Mid Indigo", "jeans"],
    ['The Authentic Stretch High-Rise Skinny | Deep Indigo | 28.5" Inseam', "jeans"],
    ["Thermal Henley in Cozy Waffle | Heathered Charcoal", "t-shirt"],
    ["Nike Dri-FIT ADV Ace Visor", "hat"],
    ["Frieze Bowling Bag - Leather", "top-handle bag"],
    ["The Cactus Leather Sling Bag | Cashew", "crossbody bag"],
    [
      "Harris Reed In Good Hands Beaded Gemstone Necklace | 18ct Gold Plated/Multi Green Gemstone & Pearl",
      "necklace",
    ],
    // Generic words stay unknown: "Shoes" alone could be sneakers or loafers.
    ["Nike Cortez Textile Men's Shoes", "sneakers"],
    ["ACG LDV Men's Shoes", null],
  ];
  for (const [title, expected] of cases) {
    test(`${title} -> ${expected}`, () => {
      expect(classifyGarmentType(title)).toBe(expected as never);
    });
  }

  test("a chain is a necklace in Jewelry, never on a bag", () => {
    expect(classifyGarmentType("Wheat Chain", null, "Jewelry")).toBe("necklace");
    expect(classifyGarmentType("Herringbone Chain", null, "Jewelry")).toBe("necklace");
    expect(classifyGarmentType("Quilted Chain Bag", null, "Bags")).toBeNull();
  });
});

describe("inferFormality", () => {
  test("sportswear markers read as athletic", () => {
    expect(inferFormality("Nike Sportswear Windrunner lightweight windbreaker")).toBe("athletic");
    expect(inferFormality("Dense, springy fleece, machine washable.")).toBe("athletic");
  });

  test("a sport coat is tailoring, not sportswear", () => {
    expect(inferFormality("Single-breasted sport coat in wool")).not.toBe("athletic");
  });

  test("lapels and double-breasting read as formal; wool and tailoring as smart", () => {
    expect(inferFormality("Tailored coat with notch lapels")).toBe("formal");
    expect(inferFormality("A relaxed fit wrap coat in soft wool cashmere")).toBe("smart");
  });

  test("tennis earrings and bracelets are a jewellery style, not sportswear", () => {
    expect(inferFormality(REVIEW_CITED_ROWS.tennisDropEarrings.title)).not.toBe("athletic");
    expect(inferFormality(REVIEW_CITED_ROWS.tennisHoopEarrings.title)).not.toBe("athletic");
    expect(inferFormality("Classic Tennis Bracelet in Gold")).not.toBe("athletic");
  });

  test("nothing to go on is unknown, not a guess", () => {
    expect(inferFormality("Machine washable.")).toBeNull();
  });
});

describe("detectPattern", () => {
  test("names the pattern the text mentions", () => {
    expect(detectPattern("Pinstripe Double-Breasted Coat | Navy")).toBe("striped");
    expect(detectPattern("The Oversized Blazer | Pale Khaki Plaid")).toBe("plaid");
    expect(detectPattern("Italian Car Coat | Taupe Herringbone")).toBe("herringbone");
    expect(detectPattern("Sleek single-breasted jacket. Micro-check pattern.")).toBe("plaid");
  });

  test("no pattern word is unknown, not solid", () => {
    expect(detectPattern("Black mid-rise midi skirt")).toBeNull();
  });

  test("everyday words in shop copy are not patterns (real seeded rows)", () => {
    expect(detectPattern(REVIEW_CITED_ROWS.lacrosseBackpack.description ?? "")).toBeNull();
    expect(detectPattern(REVIEW_CITED_ROWS.sleekPendant.description ?? "")).toBeNull();
    expect(detectPattern(REVIEW_CITED_ROWS.corduroyShorts.description ?? "")).toBeNull();
  });
});

describe("productGender", () => {
  test("the product name's women's or men's beats the column", () => {
    expect(
      productGender({
        title: "Nike Tour Repel Women's Golf Jacket",
        description: null,
        gender: "Male",
      }),
    ).toBe("Female");
  });

  test("the colourway after '|' is never read as a department (real seeded row)", () => {
    expect(productGender(REVIEW_CITED_ROWS.scarfTieDress)).toBe("Female");
  });

  // Re-review N1 (2026-10-07): an explicit women's/men's in the description
  // overrides a miscoded column, so the row is shown to ONE department. For
  // the other it is capped (not shown), never hard-ruled out.
  test("a women's in the description overrides a miscoded Male column", () => {
    const miscoded = {
      title: "Hemp Blend Twill Tailored Jacket",
      description: "A women's button-up jacket with a tailored silhouette.",
      gender: "Male",
    };
    expect(productGender(miscoded)).toBe("Female");
    expect(productAllowsGender(miscoded, "Female")).toBe(true);
    expect(productAllowsGender(miscoded, "Male")).toBe(false);
  });

  test("'Unisex design' in the description only adds a department", () => {
    const uniqloTrench = {
      title: "Trench Coat",
      description: "- Featuring a storm shield at the back. - Unisex design.",
      gender: "Female",
    };
    expect(productAllowsGender(uniqloTrench, "Female")).toBe(true);
    expect(productAllowsGender(uniqloTrench, "Male")).toBe(true);
  });

  test("store boilerplate listing everyone is not a gender claim", () => {
    expect(
      productGender({
        title: "Barn Short Jacket",
        description: "Shop stylish and comfortable clothes for women, men, kids and babies.",
        gender: "Female",
      }),
    ).toBe("Female");
  });

  test("a row without a gender column is unisex", () => {
    expect(productGender({ title: "Quilted Tote", description: null })).toBe("Unisex");
  });
});

describe("resolveDupeTarget", () => {
  test("the garment's own fit wins over the profile", () => {
    expect(resolveDupeTarget(STRIPED_FORMAL_WOMENS_COAT, "Male").gender).toBe("Female");
  });

  test("a unisex read falls back to the member's profile gender", () => {
    const unisex = { ...STRIPED_FORMAL_WOMENS_COAT, gender_fit: "unisex" as const };
    expect(resolveDupeTarget(unisex, "Female").gender).toBe("Female");
    expect(resolveDupeTarget(unisex, "Prefer not to say").gender).toBeNull();
  });

  test("jewellery, bags and accessories are never filtered on formality", () => {
    for (const category of ["Jewelry", "Bags", "Accessories"] as const) {
      const target = resolveDupeTarget(
        { ...STRIPED_FORMAL_WOMENS_COAT, category, garment_type: "other", formality: "formal" },
        "Female",
      );
      expect(target.formality).toBeNull();
    }
    const notApplicable = resolveDupeTarget(
      { ...STRIPED_FORMAL_WOMENS_COAT, formality: "not applicable" },
      "Female",
    );
    expect(notApplicable.formality).not.toBe("not applicable");
  });
});

describe("judgeCandidate", () => {
  const target = resolveDupeTarget(STRIPED_FORMAL_WOMENS_COAT, "Female");

  test("rules out every sports jacket, fleece, puffer and vest for a formal coat", () => {
    for (const product of SPORTY_OUTERWEAR) {
      expect(judgeCandidate(target, product).eligible).toBe(false);
    }
  });

  test("rules out blazers and men's coats for a women's coat", () => {
    expect(judgeCandidate(target, fixture("cuyana-cinched-blazer")).eligible).toBe(false);
    expect(judgeCandidate(target, fixture("muji-chester")).eligible).toBe(false);
  });

  test("a trench is a related coat, but not close enough to call a dupe", () => {
    const plainCoat = resolveDupeTarget({ ...STRIPED_FORMAL_WOMENS_COAT, pattern: "solid" }, null);
    const verdict = judgeCandidate(plainCoat, fixture("everlane-long-trench"));
    expect(verdict.eligible).toBe(true);
    if (verdict.eligible) expect(verdict.similarity).toBeLessThan(MIN_DUPE_SIMILARITY);
  });

  test("calibrated 2026-10-08: a real short wrap coat clears the line for a plain coat", () => {
    // The live catalogue's own row (Wool Cashmere Short Wrap Coat): before the
    // calibration it scored below 60, so the whole coat class answered
    // "nothing close" on real hunts.
    const plainCoat = resolveDupeTarget(
      { ...STRIPED_FORMAL_WOMENS_COAT, pattern: "solid" },
      "Female",
    );
    const verdict = judgeCandidate(plainCoat, fixture("cuyana-wrap-coat"));
    expect(verdict.eligible).toBe(true);
    if (verdict.eligible) {
      expect(verdict.similarity).toBeGreaterThanOrEqual(MIN_DUPE_SIMILARITY);
      expect(verdict.summary).toMatch(/A similar .*coat/);
    }
  });

  test("a striped piece only qualifies against rows that name the same pattern", () => {
    // Title names another pattern: ruled out.
    expect(ruledOutBy(judgeCandidate(target, fixture("everlane-car-coat")))).toBe("pattern");
    // Copy silent about the pattern: kept, but never shown.
    expect(qualifies(judgeCandidate(target, fixture("everlane-long-trench")))).toBe(false);
  });

  test("a plain piece is ruled out against a row whose title names a pattern", () => {
    const plainBlazer = resolveDupeTarget(
      {
        ...STRIPED_FORMAL_WOMENS_COAT,
        garment_type: "blazer",
        formality: "smart",
        pattern: "solid",
      },
      "Female",
    );
    expect(ruledOutBy(judgeCandidate(plainBlazer, fixture("everlane-plaid-blazer")))).toBe(
      "pattern",
    );
    expect(judgeCandidate(plainBlazer, fixture("cuyana-cinched-blazer")).eligible).toBe(true);
  });

  test("a matching closure adds to the score; a different one does not", () => {
    const zipCoat = resolveDupeTarget(
      { ...STRIPED_FORMAL_WOMENS_COAT, closure: "zip", key_details: [], silhouette_tags: [] },
      "Female",
    );
    const buttonCoat = resolveDupeTarget(
      {
        ...STRIPED_FORMAL_WOMENS_COAT,
        closure: "double-breasted",
        key_details: [],
        silhouette_tags: [],
      },
      "Female",
    );
    const zipVerdict = judgeCandidate(zipCoat, PINSTRIPE_COAT);
    const buttonVerdict = judgeCandidate(buttonCoat, PINSTRIPE_COAT);
    expect(zipVerdict.eligible && buttonVerdict.eligible).toBe(true);
    if (zipVerdict.eligible && buttonVerdict.eligible) {
      expect(buttonVerdict.similarity).toBeGreaterThan(zipVerdict.similarity);
    }
  });

  test("the true dupe scores as near-identical", () => {
    const verdict = judgeCandidate(target, PINSTRIPE_COAT);
    expect(verdict.eligible).toBe(true);
    if (verdict.eligible) {
      expect(verdict.similarity).toBeGreaterThanOrEqual(IDENTICAL_SIMILARITY);
      expect(verdict.summary).toBe("Same striped navy wool coat");
      expect(hasDash(verdict.summary)).toBe(false);
    }
  });

  test("below 'identical' the line says 'A similar', never 'Same'", () => {
    const camelCoat = resolveDupeTarget(
      {
        ...STRIPED_FORMAL_WOMENS_COAT,
        name: "Camel double-breasted wool coat",
        primary_color: "Camel",
        pattern: "solid",
        colors: ["camel"],
        fabric: "wool",
      },
      "Female",
    );
    const verdict = judgeCandidate(camelCoat, fixture("cuyana-wrap-coat"));
    expect(verdict.eligible).toBe(true);
    if (verdict.eligible) {
      expect(verdict.similarity).toBeLessThan(IDENTICAL_SIMILARITY);
      expect(verdict.summary.startsWith("A similar")).toBe(true);
    }
  });

  test("the admin attire tag is authoritative over the copy", () => {
    const tagged = { ...PINSTRIPE_COAT, attire: ["Athletic"] };
    expect(judgeCandidate(target, tagged).eligible).toBe(false);
  });
});

// I1 (review 2026-10-07): an unknown garment kind must never qualify.
describe("an unconfirmed garment kind never qualifies", () => {
  const trackJacket: MatchableProduct = {
    title: "Nike SB Ishod Track Jacket",
    description: "Black lightweight track jacket with two-way zippers and a hood.",
    category: "Outerwear",
    gender: "Male",
    attire: [],
  };
  const fleece: MatchableProduct = {
    title: "Fleece Full-Zip Jacket",
    description: "Black fleece with a hood, full zip.",
    category: "Outerwear",
    gender: "Unisex",
    attire: [],
  };

  test("a stored read with no garment noun never brings back sports layers", () => {
    const nounless = resolveDupeTarget(
      {
        name: "Black statement outer layer",
        category: "Outerwear",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: ["zip", "hood"],
      },
      null,
    );
    expect(qualifies(judgeCandidate(nounless, trackJacket))).toBe(false);
    expect(qualifies(judgeCandidate(nounless, fleece))).toBe(false);
    for (const product of SPORTY_OUTERWEAR) {
      expect(qualifies(judgeCandidate(nounless, product))).toBe(false);
    }
  });

  test("an AI read of 'other' (a poncho, a kimono) never lets a fleece through", () => {
    const poncho = resolveDupeTarget(
      {
        name: "Black hooded poncho",
        category: "Outerwear",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: ["zip", "hood"],
        garment_type: "other",
        gender_fit: "unisex",
        formality: "casual",
        closure: "zip",
        pattern: "solid",
        colors: ["black"],
        length: "hip",
        fabric: "fleece",
        key_details: ["hood"],
      },
      null,
    );
    expect(qualifies(judgeCandidate(poncho, fleece))).toBe(false);
    expect(qualifies(judgeCandidate(poncho, trackJacket))).toBe(false);
  });

  test("a row whose copy names no garment never qualifies either", () => {
    const nounlessRow: MatchableProduct = {
      title: "The Lucy Edit | Navy",
      description:
        "Navy and white pinstripe wool blend, double-breasted, notch lapels, knee length.",
      category: "Outerwear",
      gender: "Female",
      attire: [],
    };
    expect(qualifies(judgeCandidate(target(), nounlessRow))).toBe(false);
  });

  function target() {
    return resolveDupeTarget(STRIPED_FORMAL_WOMENS_COAT, "Female");
  }
});

// I2 (review 2026-10-07): one stray word in the shop copy must not hide a
// true dupe. Every row here is a real seeded catalogue row.
describe("a stray word in the shop copy never rules a true dupe out", () => {
  const base = {
    color_undertone: "Neutral" as const,
    gender_fit: "womenswear" as const,
    closure: "not applicable" as const,
    pattern: "solid" as const,
    length: "not applicable" as const,
  };

  test("tennis earrings stay in a formal earring hunt", () => {
    const goldDrops = resolveDupeTarget(
      {
        ...base,
        name: "Gold tennis drop earrings",
        category: "Jewelry",
        primary_color: "Gold",
        silhouette_tags: ["drop", "pave"],
        garment_type: "earrings",
        formality: "formal",
        colors: ["gold"],
        fabric: "gold vermeil",
        key_details: ["drop"],
      },
      "Female",
    );
    const drops = judgeCandidate(goldDrops, REVIEW_CITED_ROWS.tennisDropEarrings);
    expect(qualifies(drops)).toBe(true);
    // Plural garments read "Similar gold earrings", never "A similar gold earrings".
    if (drops.eligible) expect(drops.summary.startsWith("A similar")).toBe(false);

    const silverHoops = resolveDupeTarget(
      {
        ...base,
        name: "Silver hoop earrings",
        category: "Jewelry",
        primary_color: "Silver",
        silhouette_tags: ["hoop"],
        garment_type: "earrings",
        formality: "formal",
        colors: ["silver"],
        fabric: "silver plated",
        key_details: ["hoop"],
      },
      "Female",
    );
    expect(qualifies(judgeCandidate(silverHoops, REVIEW_CITED_ROWS.tennisHoopEarrings))).toBe(true);
  });

  test("bags and hats are never ruled out on formality", () => {
    const formalBag = resolveDupeTarget(
      {
        ...base,
        name: "Leather bowling bag",
        category: "Bags",
        primary_color: "Tan",
        silhouette_tags: ["structured"],
        garment_type: "top-handle bag",
        formality: "formal",
        colors: ["tan"],
        fabric: "leather",
        key_details: [],
      },
      "Female",
    );
    expect(ruledOutBy(judgeCandidate(formalBag, REVIEW_CITED_ROWS.bowlingBag))).not.toBe(
      "formality",
    );
    expect(ruledOutBy(judgeCandidate(formalBag, REVIEW_CITED_ROWS.juteBag))).not.toBe("formality");

    const smartHat = resolveDupeTarget(
      {
        ...base,
        gender_fit: "unisex",
        name: "Safari hat",
        category: "Accessories",
        primary_color: "Khaki",
        silhouette_tags: ["wide brim"],
        garment_type: "hat",
        formality: "smart",
        colors: ["khaki"],
        fabric: "cotton",
        key_details: [],
      },
      "Female",
    );
    expect(judgeCandidate(smartHat, REVIEW_CITED_ROWS.safariHat).eligible).toBe(true);
  });

  test("'Check.', 'a graphic shape' and 'flower-scented' never rule out a plain piece", () => {
    const plain = (overrides: Partial<DupeAttributes> & Pick<DupeAttributes, "category">) =>
      resolveDupeTarget(
        {
          ...base,
          name: "Plain piece",
          primary_color: "Black",
          silhouette_tags: [],
          formality: "casual",
          colors: ["black"],
          fabric: "",
          key_details: [],
          ...overrides,
        },
        null,
      );
    expect(
      judgeCandidate(
        plain({ category: "Bags", garment_type: "backpack" }),
        REVIEW_CITED_ROWS.lacrosseBackpack,
      ).eligible,
    ).toBe(true);
    expect(
      judgeCandidate(
        plain({ category: "Jewelry", garment_type: "necklace" }),
        REVIEW_CITED_ROWS.sleekPendant,
      ).eligible,
    ).toBe(true);
    expect(
      judgeCandidate(
        plain({ category: "Bottoms", garment_type: "shorts", gender_fit: "menswear" }),
        REVIEW_CITED_ROWS.corduroyShorts,
      ).eligible,
    ).toBe(true);
  });

  test("in jewellery 'herringbone' and 'solid gold' are chain styles and metals, not prints", () => {
    const silverChain = resolveDupeTarget(
      {
        ...base,
        gender_fit: "unisex",
        name: "Slim silver chain necklace",
        category: "Jewelry",
        primary_color: "Silver",
        silhouette_tags: ["chain"],
        garment_type: "necklace",
        formality: "not applicable",
        colors: ["silver"],
        fabric: "stainless steel",
        key_details: [],
      },
      null,
    );
    expect(judgeCandidate(silverChain, REVIEW_CITED_ROWS.herringboneChain).eligible).toBe(true);
    expect(qualifies(judgeCandidate(silverChain, REVIEW_CITED_ROWS.herringboneChain))).toBe(true);
  });

  test("a women's dress whose colourway is called 'Men's Navy' stays in a women's hunt", () => {
    const silkDress = resolveDupeTarget(
      {
        ...base,
        name: "Navy silk mini dress",
        category: "Dresses",
        primary_color: "Navy",
        silhouette_tags: ["scarf tie"],
        garment_type: "dress",
        formality: "smart",
        colors: ["navy"],
        length: "cropped",
        fabric: "silk",
        key_details: ["scarf tie"],
      },
      "Female",
    );
    expect(judgeCandidate(silkDress, REVIEW_CITED_ROWS.scarfTieDress).eligible).toBe(true);
  });
});

// Re-review (2026-10-07). Every row is a real seeded row with VERBATIM copy,
// except SPORTY_ROWS_NAMED_COAT (synthetic, labelled).
describe("a description conflict caps a row: never shown, never hard-ruled out", () => {
  const plain = (overrides: Partial<DupeAttributes> & Pick<DupeAttributes, "category">) =>
    resolveDupeTarget(
      {
        name: "Plain piece",
        primary_color: "Cream",
        color_undertone: "Warm",
        silhouette_tags: [],
        gender_fit: "womenswear",
        formality: "casual",
        pattern: "solid",
        colors: ["cream"],
        fabric: "",
        key_details: [],
        ...overrides,
      },
      "Female",
    );

  test("N1: a ditsy-floral top is not shown for a plain cream top", () => {
    const verdict = judgeCandidate(
      plain({ category: "Tops", garment_type: "top", name: "Plain cream top" }),
      REREVIEW_CITED_ROWS.adinaTop,
    );
    expect(verdict.eligible).toBe(true);
    expect(qualifies(verdict)).toBe(false);
  });

  test("N1: socks with varsity stripes are not shown for plain socks", () => {
    const verdict = judgeCandidate(
      plain({
        category: "Accessories",
        garment_type: "socks",
        name: "Plain pink socks",
        primary_color: "Pink",
        colors: ["pink"],
      }),
      REREVIEW_CITED_ROWS.ribbedSweaterSock,
    );
    expect(verdict.eligible).toBe(true);
    expect(qualifies(verdict)).toBe(false);
  });

  test("N1: a micro-check jacket is not shown for a plain blazer", () => {
    const verdict = judgeCandidate(
      plain({ category: "Outerwear", garment_type: "blazer", formality: "smart" }),
      REREVIEW_CITED_ROWS.relaxedTailoredJacketPattern,
    );
    expect(qualifies(verdict)).toBe(false);
  });

  test("N1: a women's down coat miscoded Male is shown to women, not to men", () => {
    const puffer = (gender_fit: "womenswear" | "menswear") =>
      resolveDupeTarget(
        {
          name: "Black long down coat",
          category: "Outerwear",
          primary_color: "Black",
          color_undertone: "Neutral",
          silhouette_tags: ["quilted"],
          garment_type: "puffer",
          gender_fit,
          formality: "casual",
          pattern: "solid",
          colors: ["black"],
          length: "knee",
          fabric: "down",
          key_details: [],
        },
        null,
      );
    const forMen = judgeCandidate(
      puffer("menswear"),
      REREVIEW_CITED_ROWS.waterRepellentDownLongCoat,
    );
    expect(forMen.eligible).toBe(true);
    expect(qualifies(forMen)).toBe(false);
    expect(
      judgeCandidate(puffer("womenswear"), REREVIEW_CITED_ROWS.waterRepellentDownLongCoat).eligible,
    ).toBe(true);
  });

  test("N1: men's copy on a Female-coded shirt keeps it out of a women's hunt", () => {
    const verdict = judgeCandidate(
      plain({
        category: "Tops",
        garment_type: "shirt",
        name: "Linen stand collar shirt",
        formality: "smart",
        fabric: "linen",
      }),
      REREVIEW_CITED_ROWS.linenStandCollarShirt,
    );
    expect(qualifies(verdict)).toBe(false);
  });

  test("N3: a sporty row NAMED 'Coat' is never shown to a formal coat hunt", () => {
    const formalStripedCoat = resolveDupeTarget(STRIPED_FORMAL_WOMENS_COAT, "Female");
    for (const row of SPORTY_ROWS_NAMED_COAT) {
      expect(qualifies(judgeCandidate(formalStripedCoat, row))).toBe(false);
    }
  });

  test("N3: 'tracksuit' reads as athletic", () => {
    expect(inferFormality("Tracksuit Coat")).toBe("athletic");
    expect(classifyGarmentType("Tracksuit Jacket")).toBe("athletic jacket");
  });
});

describe("the jewellery 'chain = necklace' rule (re-review N2)", () => {
  const otherJewellery = (name: string) =>
    resolveDupeTarget(
      {
        name,
        category: "Jewelry",
        primary_color: "Gold",
        color_undertone: "Warm",
        silhouette_tags: ["chain", "paperclip"],
        garment_type: "other",
        gender_fit: "womenswear",
        formality: "not applicable",
        closure: "not applicable",
        pattern: "solid",
        colors: ["gold"],
        length: "not applicable",
        fabric: "gold plated",
        key_details: ["chain"],
      },
      "Female",
    );

  test("an anklet, body chain or ear cuff read as 'other' never returns a necklace", () => {
    for (const name of [
      "Gold paperclip chain anklet",
      "Gold body chain",
      "Gold ear cuff with chain",
      "Gold chain belly chain",
    ]) {
      const target = otherJewellery(name);
      expect(target.kind).toBeNull();
      expect(qualifies(judgeCandidate(target, REREVIEW_CITED_ROWS.heartPendantNecklace))).toBe(
        false,
      );
    }
  });

  test("on catalogue rows, a chain that is an anklet, body chain or ear piece is not a necklace", () => {
    expect(classifyGarmentType("Paperclip Chain Anklet", null, "Jewelry")).toBeNull();
    expect(classifyGarmentType("Layered Body Chain", null, "Jewelry")).toBeNull();
    expect(
      classifyGarmentType(
        REREVIEW_CITED_ROWS.earCuffChainedHoop.title,
        REREVIEW_CITED_ROWS.earCuffChainedHoop.description,
        "Jewelry",
      ),
    ).toBe("earrings");
  });
});

describe("a kind read only from the description confirms SAME, nothing else", () => {
  test("a flip flop (a 'thong sandal' in its copy) is never shown in a heels hunt", () => {
    const heels = resolveDupeTarget(
      {
        name: "Black leather heeled sandals",
        category: "Shoes",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: ["strappy"],
        garment_type: "heels",
        gender_fit: "womenswear",
        formality: "smart",
        pattern: "solid",
        colors: ["black"],
        fabric: "leather",
        key_details: [],
      },
      "Female",
    );
    expect(qualifies(judgeCandidate(heels, REREVIEW_CITED_ROWS.leatherFlipFlop))).toBe(false);
  });

  test("a bag organizer ('your daily bag or tote') is never shown in a top-handle bag hunt", () => {
    const topHandle = resolveDupeTarget(
      {
        name: "Black top-handle bag",
        category: "Bags",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: ["structured"],
        garment_type: "top-handle bag",
        gender_fit: "unisex",
        pattern: "solid",
        colors: ["black"],
        fabric: "",
        key_details: [],
      },
      null,
    );
    expect(qualifies(judgeCandidate(topHandle, REREVIEW_CITED_ROWS.bagOrganizer))).toBe(false);
  });
});

describe("a fabric is not a register", () => {
  test("a men's business jacket in jersey stays in a men's formal blazer hunt", () => {
    const mensBlazer = resolveDupeTarget(
      {
        name: "Navy tailored blazer",
        category: "Outerwear",
        primary_color: "Navy",
        color_undertone: "Cool",
        silhouette_tags: ["tailored"],
        garment_type: "blazer",
        gender_fit: "menswear",
        formality: "formal",
        pattern: "solid",
        colors: ["navy"],
        fabric: "jersey",
        key_details: [],
      },
      null,
    );
    expect(ruledOutBy(judgeCandidate(mensBlazer, REREVIEW_CITED_ROWS.stretchJerseyJacket))).toBe(
      null,
    );
  });
});

describe("re-review kind and print edges", () => {
  test("N4: a short-sleeve tee read from its description is a t-shirt, not shorts", () => {
    const tee = REREVIEW_CITED_ROWS.swooshCitiesTee;
    expect(classifyGarmentType(tee.title, tee.description, tee.category)).toBe("t-shirt");
  });

  test("N6: a single stud is earrings, not boots or flats", () => {
    for (const row of [REREVIEW_CITED_ROWS.cowboyBootStud, REREVIEW_CITED_ROWS.pearlFlatBackStud]) {
      expect(classifyGarmentType(row.title, row.description, row.category)).toBe("earrings");
    }
  });

  test("N5: a brand or model word in a bag's name never rules the bag out", () => {
    const tote = resolveDupeTarget(
      {
        name: "Black leather tote",
        category: "Bags",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: [],
        garment_type: "tote",
        gender_fit: "unisex",
        pattern: "solid",
        colors: ["black"],
        fabric: "leather",
        key_details: [],
      },
      null,
    );
    for (const title of ["Jean Paul Gaultier Le Sac", "Cortez Bag"]) {
      const verdict = judgeCandidate(tote, {
        title,
        description: "A black leather bag.",
        category: "Bags",
        gender: "Unisex",
        attire: [],
      });
      expect(ruledOutBy(verdict)).not.toBe("kind");
    }
  });

  test("N8: a colour name is not a print; a 'Check' colourway is", () => {
    const plainCoat = resolveDupeTarget(
      { ...STRIPED_FORMAL_WOMENS_COAT, pattern: "solid" },
      "Female",
    );
    const coat = (title: string) => ({
      title,
      description: "Tailored wool coat, double-breasted, notch lapels, knee length.",
      category: "Outerwear",
      gender: "Female",
      attire: [],
    });
    expect(ruledOutBy(judgeCandidate(plainCoat, coat("Wool Coat | Floral White")))).toBeNull();
    expect(ruledOutBy(judgeCandidate(plainCoat, coat("Wool Coat | Snow Leopard")))).toBeNull();
    expect(ruledOutBy(judgeCandidate(plainCoat, coat("Wool Coat | Black Watch Check")))).toBe(
      "pattern",
    );
  });
});

// Second re-review (2026-10-07). Real seeded rows with VERBATIM copy.
describe("re-review 2, R1: a stud in the copy is not an earring", () => {
  const jewellery = (name: string, garment_type: "bracelet" | "earrings") =>
    resolveDupeTarget(
      {
        name,
        category: "Jewelry",
        primary_color: "Silver",
        color_undertone: "Neutral",
        silhouette_tags: ["spiked"],
        garment_type,
        gender_fit: "unisex",
        formality: "not applicable",
        pattern: "solid",
        colors: ["silver"],
        fabric: "stainless steel",
        key_details: ["studs", "buckle clasp"],
      },
      null,
    );

  test("the spiked 'Agitator' bracelet reads as a bracelet, not earrings", () => {
    const row = REREVIEW2_CITED_ROWS.agitator;
    expect(classifyGarmentType(row.title, row.description, row.category)).toBe("bracelet");
  });

  test("it is never shown in an earrings hunt, and is shown in a spiked bracelet hunt", () => {
    const row = REREVIEW2_CITED_ROWS.agitator;
    expect(qualifies(judgeCandidate(jewellery("Silver stud earrings", "earrings"), row))).toBe(
      false,
    );
    expect(
      qualifies(judgeCandidate(jewellery("Silver spiked cuff bracelet", "bracelet"), row)),
    ).toBe(true);
  });

  test("a stud named as a modifier in a title is not an earring", () => {
    expect(classifyGarmentType("Riveted Stud Cuff", null, "Jewelry")).toBeNull();
    expect(classifyGarmentType("Spiked Studs Choker", null, "Jewelry")).toBe("necklace");
    // A single stud named as the piece still is.
    expect(classifyGarmentType("Cowboy Boot Single Stud", null, "Jewelry")).toBe("earrings");
  });
});

describe("re-review 2, R2: jersey leans casual, except tailoring", () => {
  const dress = (formality: "casual" | "formal", colour: string) =>
    resolveDupeTarget(
      {
        name: `${colour} jersey dress`,
        category: "Dresses",
        primary_color: colour,
        color_undertone: "Neutral",
        silhouette_tags: [],
        garment_type: "dress",
        gender_fit: "womenswear",
        formality,
        pattern: "solid",
        colors: [colour.toLowerCase()],
        fabric: "jersey",
        key_details: [],
      },
      "Female",
    );

  test("a casual jersey dress hunt finds the real casual jersey dresses", () => {
    expect(
      qualifies(
        judgeCandidate(dress("casual", "Navy"), REREVIEW2_CITED_ROWS.cottonJerseyRugbyDress),
      ),
    ).toBe(true);
    expect(
      qualifies(judgeCandidate(dress("casual", "Cocoa"), REREVIEW2_CITED_ROWS.rivieraDress)),
    ).toBe(true);
  });

  test("jersey in the NAME is a strong signal: it rules a formal read out, not just caps it", () => {
    expect(
      ruledOutBy(
        judgeCandidate(dress("formal", "Black"), REREVIEW2_CITED_ROWS.sculpturalJerseyMidiDress),
      ),
    ).toBe("formality");
  });

  test("a formal black dress hunt never shows a cotton-jersey midi", () => {
    expect(
      qualifies(
        judgeCandidate(dress("formal", "Black"), REREVIEW2_CITED_ROWS.sculpturalJerseyMidiDress),
      ),
    ).toBe(false);
  });

  test("a formal trouser hunt never shows jersey tapered pants", () => {
    const formalTrousers = resolveDupeTarget(
      {
        name: "Black tailored trousers",
        category: "Bottoms",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: ["tapered"],
        garment_type: "trousers",
        gender_fit: "unisex",
        formality: "formal",
        pattern: "solid",
        colors: ["black"],
        fabric: "",
        key_details: [],
      },
      null,
    );
    expect(qualifies(judgeCandidate(formalTrousers, REREVIEW2_CITED_ROWS.jerseyTaperedPants))).toBe(
      false,
    );
  });

  test("a business shirt in jersey stays in a formal shirt hunt", () => {
    const formalShirt = resolveDupeTarget(
      {
        name: "Striped slim dress shirt",
        category: "Tops",
        primary_color: "White",
        color_undertone: "Cool",
        silhouette_tags: ["slim"],
        garment_type: "shirt",
        gender_fit: "menswear",
        formality: "formal",
        pattern: "striped",
        colors: ["white", "blue"],
        fabric: "",
        key_details: [],
      },
      null,
    );
    expect(ruledOutBy(judgeCandidate(formalShirt, REREVIEW2_CITED_ROWS.nonIronJerseyShirt))).toBe(
      null,
    );
  });

  test("a blazer or tailored jacket in jersey stays tailored", () => {
    const formalBlazer = resolveDupeTarget(
      {
        name: "Black tailored blazer",
        category: "Outerwear",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: ["tailored"],
        garment_type: "blazer",
        gender_fit: "womenswear",
        formality: "formal",
        pattern: "solid",
        colors: ["black"],
        fabric: "jersey",
        key_details: [],
      },
      "Female",
    );
    expect(
      ruledOutBy(judgeCandidate(formalBlazer, REREVIEW2_CITED_ROWS.brushedJerseyTailoredJacket)),
    ).toBeNull();
    const jerseyBlazer = {
      title: "Jersey Blazer | Black",
      description: "A soft single-button blazer.",
      category: "Outerwear",
      gender: "Female",
      attire: [],
    };
    expect(ruledOutBy(judgeCandidate(formalBlazer, jerseyBlazer))).toBeNull();
  });
});

describe("re-review 2, R3: 'unisex' beats a sizing note", () => {
  test("a unisex sneaker that 'uses men's sizing' stays in a women's hunt", () => {
    const row = REREVIEW2_CITED_ROWS.combinationSneaker;
    expect(productGender(row)).toBe("Unisex");
    expect(productAllowsGender(row, "Female")).toBe(true);
    const womensSneaker = resolveDupeTarget(
      {
        name: "Black pile-lined slip-on sneaker",
        category: "Shoes",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: ["slip-on"],
        garment_type: "sneakers",
        gender_fit: "womenswear",
        formality: "casual",
        pattern: "solid",
        colors: ["black"],
        fabric: "",
        key_details: ["pile lining"],
      },
      "Female",
    );
    expect(qualifies(judgeCandidate(womensSneaker, row))).toBe(true);
  });
});

describe("re-review 2, R4: our own kind defaults never hide a row", () => {
  const formalBlack = (garment_type: "sandals", name: string) =>
    resolveDupeTarget(
      {
        name,
        category: "Shoes",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: [],
        garment_type,
        gender_fit: "womenswear",
        formality: "formal",
        pattern: "solid",
        colors: ["black"],
        fabric: "leather",
        key_details: [],
      },
      "Female",
    );

  test("a formal read of plain black sandals and mules still finds them", () => {
    expect(
      qualifies(
        judgeCandidate(
          formalBlack("sandals", "Black leather strappy sandals"),
          REREVIEW2_CITED_ROWS.cityStrapSandal,
        ),
      ),
    ).toBe(true);
    expect(
      qualifies(
        judgeCandidate(
          formalBlack("sandals", "Black leather kitten-heel mules"),
          REREVIEW2_CITED_ROWS.kittenHeelMules,
        ),
      ),
    ).toBe(true);
  });

  test("a conflict read from the row's own description still hides it", () => {
    const formalStripedCoat = resolveDupeTarget(STRIPED_FORMAL_WOMENS_COAT, "Female");
    for (const row of SPORTY_ROWS_NAMED_COAT) {
      expect(qualifies(judgeCandidate(formalStripedCoat, row))).toBe(false);
    }
  });
});

// Third re-review (2026-10-07): S1 fixed, and every round-3 mechanism pinned
// so removing it breaks a test. Real rows are verbatim; synthetic rows are
// labelled.
describe("re-review 3, S1: a sporty description beats jersey", () => {
  test("the real Nike Mad 90 soccer jersey is never shown in a men's smart top hunt", () => {
    const smartTop = resolveDupeTarget(
      {
        name: "Black long-sleeve top",
        category: "Tops",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: [],
        garment_type: "top",
        gender_fit: "menswear",
        formality: "smart",
        pattern: "solid",
        colors: ["black"],
        fabric: "",
        key_details: [],
      },
      null,
    );
    expect(qualifies(judgeCandidate(smartTop, REREVIEW3_CITED_ROWS.mad90Tiempo))).toBe(false);
  });
});

describe("re-review 3, S3: the jersey exemption holds for every tailored kind", () => {
  const formal = (garment_type: "blazer" | "coat" | "trench coat" | "blouse", category: string) =>
    resolveDupeTarget(
      {
        name: `Black ${garment_type}`,
        category: category as DupeAttributes["category"],
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: [],
        garment_type,
        gender_fit: "womenswear",
        formality: "formal",
        pattern: "solid",
        colors: ["black"],
        fabric: "jersey",
        key_details: [],
      },
      "Female",
    );
  // SYNTHETIC titles whose only register word is "jersey", so only the
  // exemption keeps them out of a casual reading.
  const row = (title: string, category = "Outerwear") => ({
    title,
    description: "A soft single-button piece.",
    category,
    gender: "Female",
    attire: [],
  });

  test("a jersey sport coat stays in a formal blazer hunt", () => {
    expect(
      ruledOutBy(judgeCandidate(formal("blazer", "Outerwear"), row("Jersey Sport Coat | Black"))),
    ).toBeNull();
  });

  test("a jersey coat stays in a formal coat hunt (the owner's category)", () => {
    expect(
      ruledOutBy(judgeCandidate(formal("coat", "Outerwear"), row("Jersey Wrap Coat | Black"))),
    ).toBeNull();
  });

  test("a jersey mac stays in a formal trench hunt", () => {
    expect(
      ruledOutBy(judgeCandidate(formal("trench coat", "Outerwear"), row("Jersey Mac | Black"))),
    ).toBeNull();
  });

  test("a jersey blouse stays in a formal blouse hunt", () => {
    expect(
      ruledOutBy(judgeCandidate(formal("blouse", "Tops"), row("Jersey Blouse | Black", "Tops"))),
    ).toBeNull();
  });
});

describe("re-review 3, S3: jersey named only in the description caps, never rules out", () => {
  test("a cotton-jersey dress is kept but not shown in a formal black dress hunt", () => {
    const formalDress = resolveDupeTarget(
      {
        name: "Black midi dress",
        category: "Dresses",
        primary_color: "Black",
        color_undertone: "Neutral",
        silhouette_tags: [],
        garment_type: "dress",
        gender_fit: "womenswear",
        formality: "formal",
        pattern: "solid",
        colors: ["black"],
        fabric: "",
        key_details: [],
      },
      "Female",
    );
    const verdict = judgeCandidate(formalDress, REREVIEW3_CITED_ROWS.organicCottonWaistedDress);
    expect(verdict.eligible).toBe(true);
    expect(qualifies(verdict)).toBe(false);
  });
});

describe("re-review 3, S3: a bare 'stud' in a description never sets the kind", () => {
  test("'silver studs line this ... cuff bracelet' is a bracelet (SYNTHETIC)", () => {
    expect(
      classifyGarmentType(
        "Rocker Cuff",
        "Silver studs line this bold leather cuff bracelet.",
        "Jewelry",
      ),
    ).toBe("bracelet");
  });
});

describe("re-review 3, S2/S3: department claims in the description", () => {
  // SYNTHETIC rows from the re-review.
  test("an explicit women's cut beats 'unisex'", () => {
    const tee = {
      title: "Relaxed Crew Tee | Black",
      description: "A women's cut of our unisex classic, with a shorter body.",
      gender: "Unisex",
    };
    expect(productGender(tee)).toBe("Female");
    expect(productAllowsGender(tee, "Male")).toBe(false);
  });

  test("'for men' beats 'unisex'; a store list 'for women, men, kids' is not a claim", () => {
    expect(
      productGender({
        title: "Fleece Pullover",
        description: "A unisex fleece cut for men.",
        gender: "Unisex",
      }),
    ).toBe("Male");
    expect(
      productGender({
        title: "Fleece Pullover",
        description: "Shop clothes for women, men, kids and babies.",
        gender: "Unisex",
      }),
    ).toBe("Unisex");
  });

  test("a sizing note is not a department only when the copy says unisex", () => {
    // Without "unisex", "women's sizes only" is a claim about who it is for.
    const loafer = {
      title: "Leather Loafer | Black",
      description: "Available in women's sizes only.",
      gender: "Unisex",
    };
    expect(productGender(loafer)).toBe("Female");
    // With "unisex", the men's sizing note is set aside; a Male column still
    // lets women in through the unisex claim.
    const unisexStyle = {
      title: "Canvas Sneaker",
      description: "This unisex style uses men's sizing.",
      gender: "Male",
    };
    expect(productAllowsGender(unisexStyle, "Female")).toBe(true);
  });
});

describe("garmentNoun", () => {
  test("uses the garment kind when known, else a neutral word", () => {
    expect(garmentNoun(STRIPED_FORMAL_WOMENS_COAT)).toBe("coat");
    expect(
      garmentNoun({
        name: "Statement outer layer",
        category: "Outerwear",
        primary_color: "Cream",
        color_undertone: "Warm",
        silhouette_tags: [],
      }),
    ).toBe("piece");
  });
});

describe("describeIdentification", () => {
  test("reads the identification back as one plain line", () => {
    expect(
      describeIdentification({ ...STRIPED_FORMAL_WOMENS_COAT, closure: "double-breasted" }),
    ).toBe("A women's navy and white striped double-breasted wool blend coat, knee length, formal");
  });

  test("leaves out what was not identified, and never uses a dash", () => {
    const line = describeIdentification({
      name: "Statement outer layer",
      category: "Outerwear",
      primary_color: "Cream",
      color_undertone: "Warm",
      silhouette_tags: ["quilted"],
    });
    expect(line).toBe("A cream piece");
    expect(hasDash(line)).toBe(false);
  });

  test("uses 'an' before a vowel and skips the department for unisex", () => {
    expect(
      describeIdentification({
        ...STRIPED_FORMAL_WOMENS_COAT,
        gender_fit: "unisex",
        garment_type: "athletic jacket",
        formality: "athletic",
        closure: "zip",
        pattern: "solid",
        colors: ["olive"],
        fabric: "",
        length: "hip",
      }),
    ).toBe("An olive athletic jacket, hip length, sporty");
  });

  test("never prints 'not applicable', repeats a word, or says 'a boots'", () => {
    const boots: DupeAttributes = {
      name: "Black leather knee boots",
      category: "Shoes",
      primary_color: "Black",
      color_undertone: "Neutral",
      silhouette_tags: ["knee-high"],
      garment_type: "boots",
      gender_fit: "womenswear",
      formality: "smart",
      closure: "zip",
      pattern: "solid",
      colors: ["black"],
      length: "not applicable",
      fabric: "not applicable",
      key_details: [],
    };
    expect(describeIdentification(boots)).toBe("A pair of women's black boots, smart");
    expect(
      describeIdentification({
        ...boots,
        name: "Gold hoops",
        category: "Jewelry",
        garment_type: "earrings",
        fabric: "gold vermeil",
        colors: ["gold"],
        formality: "not applicable",
      }),
    ).toBe("A pair of women's gold vermeil earrings");
  });
});
