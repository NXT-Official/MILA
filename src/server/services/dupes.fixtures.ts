/**
 * Catalogue fixtures for the Dupe Hunter tests. The Outerwear rows are real
 * rows from the seeded catalogue (supabase/migrations/20260924100000_* and
 * 20260925140000_*), trimmed to the columns rankDupes reads, so the tests run
 * against the same mix of tailored coats, sports jackets, fleeces, puffers
 * and vests the live Outerwear category holds. One synthetic row
 * (`pinstripe-coat`) stands in for a true dupe of a striped formal coat,
 * which the live catalogue does not carry yet.
 */

export type FixtureProductRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  price: number;
  currency: string;
  image_url: string | null;
  affiliate_link: string;
  brand_id: string;
  seasonal_palettes: string[];
  available_regions: string[];
  in_stock: boolean;
  verification_status: string;
  last_verified_at: string | null;
  rating: number | null;
  units_sold: number | null;
  shipping_info: string | null;
  discount_percent: number | null;
  brands: { is_verified_seller: boolean } | null;
  gender?: string;
  attire?: string[];
};

function row(
  id: string,
  title: string,
  gender: string,
  price: number,
  description: string,
  category = "Outerwear",
): FixtureProductRow {
  return {
    id,
    title,
    description,
    category,
    price,
    currency: "USD",
    image_url: null,
    affiliate_link: `https://shop.example.com/${id}`,
    brand_id: "brand-1",
    seasonal_palettes: ["Winter"],
    available_regions: [],
    in_stock: true,
    verification_status: "verified",
    last_verified_at: null,
    rating: null,
    units_sold: null,
    shipping_info: null,
    discount_percent: null,
    brands: { is_verified_seller: true },
    gender,
    attire: [],
  };
}

/** Sports jackets, fleeces, puffers and vests: never a dupe for a tailored coat. */
export const SPORTY_OUTERWEAR = [
  row(
    "nike-windrunner",
    "Nike Sportswear Windrunner Men's Hooded Jacket",
    "Male",
    59.97,
    "Lightweight windbreaker, recycled polyester, mesh lining, chevron detailing, roomy fit for layering.",
  ),
  row(
    "uniqlo-fleece",
    "Fleece Full-Zip Jacket",
    "Unisex",
    39.9,
    "Dense, springy fleece, machine washable.",
  ),
  row(
    "nike-shori-track",
    "Nike Sportswear Tech Men's Dri-FIT Shori Knit Track Jacket",
    "Male",
    90,
    "This jacket is crafted with midweight, tightly knit fabric that's smooth, stretchy and sweat wicking.",
  ),
  row(
    "nike-premier-track",
    "Nike Premier Repel Men's Soccer Hooded Woven Track Jacket",
    "Male",
    75,
    "A nod to Nike's '90s soccer roots, this water-repellent jacket is made with woven, ripstop fabric.",
  ),
  row(
    "nike-sb-track",
    "Nike SB Ishod Track Jacket",
    "Male",
    80,
    "Designed in partnership with Ishod Wair, this lightweight track jacket comes through with two-way zippers.",
  ),
  row(
    "nike-golf-women",
    "Nike Tour Repel Women's Golf Jacket",
    "Female",
    85,
    "Don't let a little rain force you off the green. With a fully removable hood and water-repellent fabric.",
  ),
  row(
    "muji-boa-fleece-coat",
    "Boa Fleece Coat",
    "Female",
    49.9,
    "This boa fleece coat is made from recycled PET bottles for a soft, lightweight fabric that stretches with you.",
  ),
  row(
    "uniqlo-pile-fleece",
    "Pile Lined Fleece Combination Jacket",
    "Female",
    49.9,
    "- Practical design with pockets on both sides and at the left chest. - Comfortable fit with raglan sleeves.",
  ),
  row(
    "nike-swoosh-vest",
    "Nike Sportswear Swoosh Series Women's Loose Therma-FIT Hooded Down Vest",
    "Female",
    120,
    "Bundle up in this versatile vest. Crafted with heavyweight down insulation, Therma-FIT tech and plush pile.",
  ),
  row(
    "everlane-quilted-vest",
    "ReNew Quilted Vest | Coffee Bean",
    "Female",
    98,
    "This onion-quilted vest has your back (and your front).",
  ),
  row(
    "everlane-puffer-bomber",
    "The Puffer Bomber | Kalamata",
    "Female",
    148,
    "Stay snug with the Puffer Bomber. Featuring a center-front two-way zipper with double zipper pulls.",
  ),
  row(
    "uniqlo-down-short",
    "Reversible Down Short Jacket",
    "Female",
    89.9,
    "- Collar stands neatly and looks good when worn open. - Reversible design with a shiny quilted finish.",
  ),
];

/** Women's tailored coats and blazers: never a dupe for a men's track jacket. */
export const WOMENS_FORMAL_OUTERWEAR = [
  row(
    "everlane-long-trench",
    "The Cotton Long Trench Coat | Beech",
    "Female",
    228,
    "A true wardrobe icon, the trench coat is a timeless staple you'll love for years to come.",
  ),
  row(
    "everlane-car-coat",
    "Italian Car Coat | Taupe Herringbone",
    "Female",
    298,
    "Features a contrast collar and front patch pockets. Heavyweight, herringbone design made from a recycled wool blend.",
  ),
  row(
    "cuyana-wrap-coat",
    "Wool Cashmere Short Wrap Coat",
    "Female",
    598,
    "The epitome of off-duty polish. A relaxed fit, true wrap coat knitted in Italy from soft wool cashmere.",
  ),
  row(
    "cuyana-cinched-blazer",
    "Wool Cinched Blazer",
    "Female",
    398,
    "A modern take on power dressing. Impeccably tailored in Portugal from Italian twill.",
  ),
  row(
    "everlane-plaid-blazer",
    "The Oversized Blazer in Buttersmooth | Pale Khaki Plaid",
    "Female",
    178,
    "Our best-selling blazer reworked in a TENCEL Lyocell and cotton blend, with a roomy, menswear-inspired fit.",
  ),
];

/** Men's coats: the right garment, the wrong fit for a women's coat. */
export const MENS_COATS = [
  row(
    "everlane-rewool-car-coat",
    "ReWool Car Coat | Heather Charcoal",
    "Male",
    298,
    "Think of this as the workhorse of your winter wardrobe. Heavy recycled wool-blend fabric for warmth, clean finish.",
  ),
  row(
    "muji-chester",
    "Wool Blend Chester Coat",
    "Male",
    199,
    "This elegant Chester coat is made with a plump wool-blend fabric that will keep you warm in colder seasons.",
  ),
  row(
    "cos-overcoat",
    "Technical Wool Overcoat",
    "Male",
    290,
    "Boxy, water-resistant wool overcoat with a clean collar.",
  ),
];

/** A true dupe for a navy pinstripe formal women's coat. */
export const PINSTRIPE_COAT = row(
  "pinstripe-coat",
  "Pinstripe Double-Breasted Wool-Blend Coat | Navy",
  "Female",
  129,
  "Tailored knee-length coat in a navy and white pinstripe wool blend, with notch lapels and flap pockets.",
);

/** Rows from other categories, so a category leak would show up. */
export const OTHER_CATEGORIES = [
  row(
    "ganni-stripe-top",
    "Long-sleeve Top in Double Stripe",
    "Female",
    215,
    "Slim-fit double-layered top, round neckline, long sleeves, organic cotton/elastane, Strong Blue.",
    "Tops",
  ),
  row(
    "reformation-skirt",
    "Jeane Skirt",
    "Female",
    128,
    "Black mid-rise midi skirt with side slit and slim column silhouette, crepe fabric.",
    "Bottoms",
  ),
];

export const OUTERWEAR_CATALOGUE = [
  ...SPORTY_OUTERWEAR,
  ...WOMENS_FORMAL_OUTERWEAR,
  ...MENS_COATS,
  ...OTHER_CATEGORIES,
];

/**
 * The owner's Zara report (2026-10-07), as a four-row SYNTHETIC catalogue
 * (written for the test, not seeded rows): a women's striped wool overcoat
 * (the look-alike), a men's sports track jacket (what the old ranking
 * returned: cheapest, same category), a women's puffer and a women's plain
 * wool coat (right garment, wrong pattern). ZARA_CASE_REAL_ROWS adds real
 * seeded rows so the test does not only reward copy written for it.
 */
export const ZARA_STRIPED_OVERCOAT = row(
  "zara-striped-overcoat",
  "Women's Pinstripe Wool-Blend Overcoat | Navy",
  "Female",
  129,
  "Tailored double-breasted overcoat in a navy pinstripe wool blend with notch lapels. Knee length.",
);
export const ZARA_TRACK_JACKET = row(
  "zara-track-jacket",
  "Men's Sports Track Jacket | Black",
  "Male",
  45,
  "Lightweight full-zip track jacket in recycled polyester for training.",
);
export const ZARA_PUFFER = row(
  "zara-womens-puffer",
  "Women's Quilted Puffer Jacket | Navy",
  "Female",
  79,
  "Water-repellent padded puffer with a stand collar and zip front.",
);
export const ZARA_PLAIN_COAT = row(
  "zara-plain-wool-coat",
  "Women's Wool Coat | Navy",
  "Female",
  99,
  "Tailored single-breasted coat in plain navy wool. Knee length.",
);
export const ZARA_CASE_CATALOGUE = [
  ZARA_TRACK_JACKET,
  ZARA_PUFFER,
  ZARA_PLAIN_COAT,
  ZARA_STRIPED_OVERCOAT,
];

/** REAL seeded Outerwear rows for the Zara case: a tailored coat, a trench
 * and a track jacket, none of them striped. */
export const ZARA_CASE_REAL_ROWS = [
  WOMENS_FORMAL_OUTERWEAR.find((r) => r.id === "cuyana-wrap-coat") as FixtureProductRow,
  WOMENS_FORMAL_OUTERWEAR.find((r) => r.id === "everlane-long-trench") as FixtureProductRow,
  SPORTY_OUTERWEAR.find((r) => r.id === "nike-sb-track") as FixtureProductRow,
];

/** More REAL seeded trenches, for a recall check on real shop copy. */
export const REAL_TRENCHES = [
  row(
    "everlane-modern-trench",
    "The Modern Trench Coat | Deep Taupe",
    "Female",
    228,
    "Fully lined, it's made with 100% organic cotton on the coat itself and 100% recycled polyester in the body lining.",
  ),
  row(
    "uniqlo-trench",
    "Trench Coat",
    "Female",
    129.9,
    "- Featuring a storm shield at the back. - Can be worn buttoned on the right or left side. - Unisex design.",
  ),
];

/**
 * REAL seeded rows the D-DUPE review (2026-10-07) found wrongly ruled out by
 * one stray word in the shop copy ("tennis" earrings read as sportswear,
 * "Stick? Check." read as plaid, "| Men's Navy/Birch" colourway read as a
 * men's dress), or misclassified by kind. Titles are verbatim; most
 * descriptions are ABRIDGED from the seeded text (the re-review re-ran every
 * verdict on the full copy and they hold).
 */
export const REVIEW_CITED_ROWS = {
  tennisDropEarrings: row(
    "missoma-tennis-drop-earrings",
    "Lucy Williams Tennis Small Drop Earrings | 18ct Gold Vermeil",
    "Female",
    98,
    "Celebrating ten years of the original jewellery collaboration with style icon Lucy Williams.",
    "Jewelry",
  ),
  tennisHoopEarrings: row(
    "tennis-small-hoop-earrings",
    "Tennis Small Hoop Earrings | Silver Plated/Sapphire Blue Nano-crystal",
    "Female",
    45,
    "Metal: Silver Plated on Brass Gemstone: Sapphire Blue Nano-crystal Weight: 4.6g Hoop Dimensions: Outer Diameter: 13.8mm",
    "Jewelry",
  ),
  juteBag: row(
    "muji-jute-bag-small",
    "Jute Bag Small",
    "Unisex",
    9.9,
    "The perfect bag for holding groceries or running errands with ease. Using uncolored jute material, this versatile bag offers a variety of practical uses.",
    "Bags",
  ),
  bowlingBag: row(
    "montmartre-bowling-bag",
    "Montmartre Bowling Bag - Leather",
    "Female",
    395,
    "Introducing the Montmartre bowling bag: a sportswear icon, renewed for the city. It's made from premium Italian leather that's subtly grained.",
    "Bags",
  ),
  safariHat: row(
    "uniqlo-safari-hat",
    "Water Repellent Safari Hat",
    "Unisex",
    24.9,
    "This safari hat is made with water-repellent, moisture-wicking materials and features water repellent tape, making it ideal for outdoor adventures.",
    "Accessories",
  ),
  lacrosseBackpack: row(
    "nike-zone-lacrosse-backpack",
    "Nike Zone Lacrosse Backpack (34L)",
    "Female",
    75,
    "Stick? Check. Mouth guard? Check. Gloves? Check. A bag to hold all of your gear? Check it off the list right now.",
    "Bags",
  ),
  sleekPendant: row(
    "sleek-pendant-gold",
    "Sleek Pendant Gold",
    "Unisex",
    120,
    "Inspired by the steep and iconic mountains in the western parts of Norway, the Sleek Pendant is a delicate take on a graphic shape.",
    "Jewelry",
  ),
  corduroyShorts: row(
    "acg-dolomiti-corduroy-shorts",
    "ACG Dolomiti Corduroy Shorts",
    "Male",
    70,
    "Ears filled with birdsong and a lungful of flower-scented air. We drew inspiration for these soft yet structured corduroy shorts from the grassy meadows.",
    "Bottoms",
  ),
  scarfTieDress: row(
    "scarf-tie-mini-dress",
    "Scarf-Tie Mini Dress in Silk Georgette | Men's Navy/Birch",
    "Female",
    128,
    "A fluid silhouette with a scarf-tie detail that adds just enough drama. Light, drapey, and one you'll want to wear more than once.",
    "Dresses",
  ),
  herringboneChain: row(
    "herringbone-chain",
    "Herringbone Chain",
    "Unisex",
    65,
    "This slender herringbone chain features a custom logo tag and is versatile enough for everyday wear. Materials: Stainless Steel. 45cm in length.",
    "Jewelry",
  ),
  trenchJacket: row(
    "ganni-trench-jacket",
    "Trench Jacket in Double Cotton",
    "Female",
    690,
    "Black double-breasted organic cotton jacket, curved puff sleeves, hood, two removable waist belts.",
  ),
  tailoredZipJacket: row(
    "everlane-tailored-zip-jacket",
    "Tailored Zip Jacket | Black",
    "Male",
    198,
    "Cut from Tailor Twill with a smooth, structured hand, this jacket features a sleek full zip, hidden snap closures on the pocket flaps, and a fully lined interior.",
  ),
  chinoShort: row(
    "everlane-performance-chino-short",
    'The 7" Slim-Fit Performance Chino Short | Slate Grey',
    "Male",
    60,
    "The Performance Chino Short is sweat-wicking, quick-drying, and has 4-way stretch, plus an authentic chino look designed for everyday wear.",
    "Bottoms",
  ),
};

/**
 * REAL seeded rows the D-DUPE re-review (2026-10-07) cited, with VERBATIM
 * titles and descriptions: rows whose description names a print or a
 * department that the title and the gender column do not, plus misread
 * kinds.
 */
export const REREVIEW_CITED_ROWS = {
  adinaTop: row(
    "reformation-adina-top",
    "Adina Top",
    "Female",
    148,
    "Short-sleeved cream ditsy-floral top with curved neckline, button front, split hem; organic cotton/ECOVERO viscose blend.",
    "Tops",
  ),
  ribbedSweaterSock: row(
    "everlane-ribbed-sweater-sock-fuchsia",
    "The Ribbed Sweater Sock | Fuchsia Pink",
    "Female",
    25,
    "Slip into the luxurious warmth of our Ribbed Sweater Sock. Crafted from a premium blend of recycled nylon, lyocell, GRS-certified recycled cashmere, and silk, this cozy style features color-block varsity stripes with",
    "Accessories",
  ),
  relaxedTailoredJacketPattern: row(
    "uniqlo-relaxed-tailored-jacket-pattern",
    "Relaxed Tailored Jacket | Pattern",
    "Female",
    69.9,
    "- Sleek single-breasted jacket in a hip length that pairs well with voluminous bottoms. - Micro-check pattern.",
  ),
  waterRepellentDownLongCoat: row(
    "muji-water-repellent-down-long-coat",
    "Water-Repellent Down Long Coat",
    "Male",
    199,
    "A fluffy women's water-repellent down coat with fill power 750 down. Its knee-length design provides excellent protection from the cold, keeping you warm and cozy in the winter.",
  ),
  hempTailoredJacket: row(
    "muji-hemp-blend-twill-tailored-jacket",
    "Hemp Blend Twill Tailored Jacket",
    "Male",
    89,
    "A women's button-up jacket with a tailored silhouette made with twilled hemp and organic cotton for a soft, fluffy material that's comfortable and breezy.",
  ),
  linenStandCollarShirt: row(
    "muji-linen-stand-collar-shirt",
    "Linen Stand Collar Shirt",
    "Female",
    49,
    "A classic men's stand collar shirt made with durable pre-washed linen that gets softer with each wear. Breathable and lightweight, you can wear it on its own, or layered over a t-shirt.",
    "Tops",
  ),
  swooshCitiesTee: row(
    "nike-swoosh-cities-new-york",
    "Nike Swoosh Cities New York",
    "Female",
    35,
    "Find the Nike Swoosh Cities New York Women's Short-Sleeve Boxy T-Shirt at Nike.com. Free delivery and returns.",
    "Tops",
  ),
  cowboyBootStud: row(
    "cowboy-boot-single-stud",
    "Cowboy Boot Single Stud",
    "Female",
    40,
    "The Cowboy Boot Single Stud is a versatile pair of earrings that adds a touch of elegance to any look. Wear it solo for subtle shine or layered with other favorites for a personalized, effortless style.",
    "Jewelry",
  ),
  pearlFlatBackStud: row(
    "gold-pearl-flat-back-single-stud",
    "14K Gold Pearl Flat Back Single Stud",
    "Female",
    120,
    "The Pearl Flat Back Single Stud is a versatile pair of earrings that adds a touch of elegance to any look. Wear it solo for subtle shine or layered with other favorites for a personalized, effortless style.",
    "Jewelry",
  ),
  heartPendantNecklace: row(
    "mini-ridge-heart-charm-pendant-necklace",
    "Mini Ridge Heart Charm Pendant Necklace | 18ct Gold Plated",
    "Female",
    95,
    "Pendant Metal: 18ct Gold Plated on Brass Chain Metal: 18ct Gold Plated Vermeil on Sterling Silver Length: Short Charm Dimensions: 15.5mm x 10mm Total length: 45cm with continuous extension from 41cm to 45cm Weight: 4g",
    "Jewelry",
  ),
  stretchJerseyJacket: row(
    "muji-stretch-jersey-jacket",
    "Stretch Jersey Jacket",
    "Male",
    99,
    "This lightweight men's business jacket features a soft, stretchy jersey fabric that provides all-day comfort. Its sleek design makes it suitable for any occasion. Made from partially recycled materials.",
  ),
  leatherFlipFlop: row(
    "everlane-leather-flip-flop-black",
    "The Leather Flip Flop | Black",
    "Female",
    65,
    "This thong sandal features unique stitch detailing and a leather-wrapped toe post for all-day comfort. The bovine leather footbed lining and bio-based EVA foam cushioning make every step feel like a breeze.",
    "Shoes",
  ),
  bagOrganizer: row(
    "muji-parachute-cloth-large-bag-organizer-black",
    "Parachute Cloth Large Bag Organizer - Black",
    "Unisex",
    19.9,
    "Enhance your daily bag or tote with this large parachute cloth organizer. It offers additional pockets to help you keep your belongings neatly arranged and easy to find.",
    "Bags",
  ),
  earCuffChainedHoop: row(
    "river-ear-cuff-chained-hoop",
    "River Ear Cuff Chained Hoop",
    "Unisex",
    85,
    "The River Ear Cuff Chained Hoop is an edgy and sculptural ear piece where craftsmanship meets modern design. The ear cuff and the hoop are linked together by a detachable chain allowing for multiple styling options.",
    "Jewelry",
  ),
};

/** SYNTHETIC sporty rows NAMED "Coat" (the re-review's latent N3 case): the
 * sport is only in the description, or in "tracksuit". */
export const SPORTY_ROWS_NAMED_COAT = [
  row(
    "synthetic-club-coat",
    "Club Coat | Navy",
    "Female",
    90,
    "A track coat cut for training days, with white stripes down the sleeves. Navy wool blend, knee length, double-breasted.",
  ),
  row(
    "synthetic-stadium-coat",
    "Striped Stadium Coat",
    "Female",
    95,
    "A sideline coat for the football season. Navy wool blend with stripes, double-breasted, knee length.",
  ),
  row(
    "synthetic-tracksuit-coat",
    "Tracksuit Coat | Navy Stripe",
    "Female",
    80,
    "Navy striped tracksuit top, knee length, double-breasted, wool.",
  ),
];

/**
 * REAL seeded rows the second D-DUPE re-review (2026-10-07) cited, with
 * VERBATIM titles and descriptions: a spiked bracelet whose copy says
 * "studs", casual jersey pieces, a unisex sneaker with a men's sizing note,
 * and plain sandals a formal read must still find.
 */
export const REREVIEW2_CITED_ROWS = {
  agitator: row(
    "vitaly-agitator",
    "Agitator",
    "Unisex",
    90,
    "Featuring riveted studs adjoined to sleek hinging plates and a streamlined buckle clasp, the Agitator is a contemporary version of the classic spiked bracelet.",
    "Jewelry",
  ),
  combinationSneaker: row(
    "uniqlo-combination-sneaker",
    "Combination Sneaker",
    "Unisex",
    39.9,
    "- Soft pile lining. - Comfortable to wear without socks. - Excellent flexibility makes for comfortable walking. - “Please note: this unisex product uses men’s sizing.",
    "Shoes",
  ),
  cottonJerseyRugbyDress: row(
    "cotton-jersey-rugby-dress",
    "Cotton Jersey Rugby Dress",
    "Female",
    120,
    "This dress features a 2-ply jersey knit design, with two strands of organic cotton yarn intricately woven together to create a soft and moderately thick fabric. It features a classic rugby-style collar.",
    "Dresses",
  ),
  sculpturalJerseyMidiDress: row(
    "sculptural-cotton-jersey-midi-dress",
    "Sculptural Cotton-jersey Midi Dress",
    "Female",
    450,
    "This sculptural midi dress is crafted from soft cotton-jersey in an enduring black tone. The sleeveless silhouette is defined by curved seams and a softly flared midi hem that creates a sense of movement.",
    "Dresses",
  ),
  rivieraDress: row(
    "everlane-long-sleeve-riviera-dress-cocoa",
    "The Long-Sleeve Riviera Dress | Cocoa",
    "Female",
    98,
    "Made from a stretchy Supima® cotton jersey, The Riviera Dress features a comfortable long-sleeve knit top with a rounded scoop neck and a voluminous woven bottom.",
    "Dresses",
  ),
  jerseyTaperedPants: row(
    "jersey-tapered-pants",
    "Jersey Tapered Pants",
    "Unisex",
    49.9,
    "Soft stretch recycled poly/rayon/nylon/spandex blend, slim tapered leg.",
    "Bottoms",
  ),
  nonIronJerseyShirt: row(
    "uniqlo-super-non-iron-jersey-slim-shirt-striped",
    "Super Non-Iron Jersey Slim Shirt | Striped",
    "Male",
    39.9,
    "- Fabric made with fine-count double-ply thread for a premium texture and a natural glossy sheen.",
    "Tops",
  ),
  brushedJerseyTailoredJacket: row(
    "muji-brushed-jersey-tailored-jacket",
    "Brushed Jersey Tailored Jacket",
    "Male",
    99,
    "A women's button-up jacket with a soft, stretchy jersey fabric, knitted to give it the crispness and body of a jacket, resulting in a comfortable fit while maintaining a polished look.",
  ),
  cityStrapSandal: row(
    "everlane-city-strap-sandal-black",
    "The City Strap Sandal | Black",
    "Female",
    98,
    "With soft leather straps that hug your foot just right and an adjustable buckle for the perfect fit, this sandal is as effortless as warm-weather dressing should be. The bio-based EVA foam footbed? Cloud-level comfort.",
    "Shoes",
  ),
  kittenHeelMules: row(
    "leather-kitten-heel-mules",
    "Leather Kitten-heel Mules",
    "Female",
    590,
    "Inspired by '90s minimalism, these mules rest on conical kitten heels that lend subtle refinement to the daily wardrobe. They are designed with sculptural square toes and are crafted from supple leather that's tanned a timeless black hue.",
    "Shoes",
  ),
};

/**
 * REAL seeded rows the third D-DUPE re-review (2026-10-07) cited, with
 * VERBATIM titles and descriptions: a soccer jersey whose copy is sporty, and
 * a dress whose description says it is cotton jersey.
 */
export const REREVIEW3_CITED_ROWS = {
  mad90Tiempo: row(
    "nike-mad-90-pack-tiempo",
    'Nike Mad 90 Pack "Tiempo"',
    "Male",
    80,
    // Verbatim seeded copy; its em dash is built from the code point so the
    // source itself carries none.
    `This long-sleeve jersey channels energy from the iconic 2005 Tiempo, a cleat that represented soccer through its most expressive era${String.fromCharCode(0x2014)}when the game was played with shameless joy.`,
    "Tops",
  ),
  organicCottonWaistedDress: row(
    "everlane-organic-cotton-waisted-dress-black",
    "The Organic Cotton Waisted Dress | Black",
    "Female",
    88,
    "Made with certified organic cotton jersey, The Organic Cotton Waisted Dress, features a classic crew neck with a slouchy bodice, a banded-and-cinched waist with a full skirt and midi length.",
    "Dresses",
  ),
};
