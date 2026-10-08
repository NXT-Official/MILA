/**
 * One small line icon per garment, for the badge on recommended products.
 *
 * lucide-react ships a shirt, bags, a gem, glasses and a watch; the rest
 * (trousers, dress, jacket, shoes, socks, belt, scarf, hats, ring) only exist
 * in Lucide Lab, which is not a dependency. Their icon nodes are copied here
 * verbatim, attributes and React keys included, and built with lucide-react's
 * own factory so they share stroke, sizing and the automatic aria-hidden.
 *
 * Lab icons: ISC licence, Copyright (c) Lucide Icons and Contributors.
 */
// src: node_modules/lucide-react/dist/lucide-react.d.ts · lucide-react 0.575.0 · createLucideIcon(iconName, iconNode), type IconNode
import {
  Backpack,
  Gem,
  Glasses,
  Handbag,
  Shirt,
  Tag,
  Watch,
  createLucideIcon,
  type IconNode,
  type LucideIcon,
} from "lucide-react";
import type { Garment, GarmentKind } from "@/lib/garment-label";

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/trousers.ts · @lucide/lab 0.7.0
const trousersNode: IconNode = [
  ["path", { d: "M4 6h16", key: "1o0s65" }],
  [
    "path",
    {
      d: "M6 22a2 2 0 0 1-2-2V3c0-.6.4-1 1-1h14c.6 0 1 .4 1 1v17a2 2 0 0 1-2 2h-3l-3-10-3 10Z",
      key: "1rdpth",
    },
  ],
  ["path", { d: "m6 11-2 1", key: "wg0633" }],
  ["path", { d: "M9 8.5V6", key: "195be6" }],
  ["path", { d: "M15 6v2.5", key: "c1bjdm" }],
  ["path", { d: "m20 12-2-1", key: "1sfjm0" }],
  ["path", { d: "M4 18h6", key: "1jikk7" }],
  ["path", { d: "M14 18h6", key: "1m8k6r" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/skirt.ts · @lucide/lab 0.7.0
const skirtNode: IconNode = [
  ["rect", { width: "12", height: "4", x: "6", y: "3", key: "bdw6vj" }],
  ["path", { d: "M6 7c0 1.7-.4 3.3-1 4.4C3.8 13.6 2 17 2 17s1.8 1.2 4.5 2.1", key: "qouldt" }],
  ["path", { d: "m8 16-2 4s2.7 1 6 1 6-1 6-1l-2-4", key: "1gwzr8" }],
  [
    "path",
    { d: "M17.5 19.1C20.2 18.2 22 17 22 17s-1.8-3.4-3-5.6c-.6-1.1-1-2.7-1-4.4", key: "wxgezq" },
  ],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/shorts.ts · @lucide/lab 0.7.0
const shortsNode: IconNode = [
  ["path", { d: "M2 8h20", key: "d11cs7" }],
  [
    "path",
    {
      d: "M9 20H4a2 2 0 0 1-2-2V5c0-.6.4-1 1-1h18c.6 0 1 .4 1 1v13a2 2 0 0 1-2 2h-5l-3-5Z",
      key: "17og06",
    },
  ],
  ["path", { d: "M9 12V8", key: "2l2gzn" }],
  ["path", { d: "M15 8v4", key: "1tfguq" }],
  ["path", { d: "m5 13-3 2", key: "1pooxw" }],
  ["path", { d: "m22 15-3-2", key: "jeffwy" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/dress.ts · @lucide/lab 0.7.0
const dressNode: IconNode = [
  [
    "path",
    {
      d: "M16 2v3a5.14 5.14 0 0 1 .7 4.8l-.2.5a7.64 7.64 0 0 0 .4 6.3C17.7 17.9 19 20 19 20s-3.1 2-7 2-7-2-7-2 1.3-2.1 2.1-3.5a7.64 7.64 0 0 0 .4-6.2l-.2-.5A5.66 5.66 0 0 1 8 5V2",
      key: "10k3lb",
    },
  ],
  ["path", { d: "M16 5c-1.8 0-3.3 1-4 2.5C11.3 6 9.8 5 8 5", key: "7jp3y9" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/jacket.ts · @lucide/lab 0.7.0
const jacketNode: IconNode = [
  ["path", { d: "M8 4c0 1.1 1.8 2 4 2s4-.9 4-2V3c0-.6-.4-1-1-1H9c-.6 0-1 .4-1 1Z", key: "52eoml" }],
  ["path", { d: "M8 4c0 2 4 5 4 10v8", key: "ddivog" }],
  ["path", { d: "M12 14c0-5 4-8 4-10", key: "1hkkb4" }],
  ["path", { d: "M6 19H3c-.6 0-1-.4-1-1V7c0-1.1.8-2.3 1.9-2.6L8 3", key: "1v55fg" }],
  ["path", { d: "M18 9v12c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9", key: "1erupy" }],
  ["path", { d: "m16 3 4.1 1.4C21.2 4.7 22 5.9 22 7v11c0 .6-.4 1-1 1h-3", key: "cyu0sn" }],
  ["path", { d: "m6 15 2-2", key: "hgibns" }],
  ["path", { d: "m18 15-2-2", key: "60u0ii" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/vest.ts · @lucide/lab 0.7.0
const vestNode: IconNode = [
  [
    "path",
    {
      d: "M10 4a2 2 0 0 0 4 0V3h4v3c0 1.7 1.3 3 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9c1.7 0 3-1.3 3-3V3h4Z",
      key: "1aiibo",
    },
  ],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/sweater.ts · @lucide/lab 0.7.0
const sweaterNode: IconNode = [
  [
    "path",
    {
      d: "M6 19H3c-.6 0-1-.4-1-1V6c0-1.1.8-2.3 1.9-2.6L8 2a4 4 0 0 0 8 0l4.1 1.4C21.2 3.7 22 4.9 22 6v12c0 .6-.4 1-1 1h-3",
      key: "9k6art",
    },
  ],
  ["path", { d: "M18 8v13c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V8", key: "2ru6tq" }],
  ["path", { d: "m6 10 2 2 2-2 2 2 2-2 2 2 2-2", key: "fk3thp" }],
  ["path", { d: "m6 16 2 2 2-2 2 2 2-2 2 2 2-2", key: "13bq4g" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/sneaker.ts · @lucide/lab 0.7.0
const sneakerNode: IconNode = [
  ["path", { d: "M14.1 7.9 12.5 10", key: "1omg66" }],
  ["path", { d: "M17.4 10.1 16 12", key: "klmssx" }],
  [
    "path",
    {
      d: "M2 16a2 2 0 0 0 2 2h13c2.8 0 5-2.2 5-5a2 2 0 0 0-2-2c-.8 0-1.6-.2-2.2-.7l-6.2-4.2c-.4-.3-.9-.2-1.3.1 0 0-.6.8-1.2 1.1a3.5 3.5 0 0 1-4.2.1C4.4 7 3.7 6.3 3.7 6.3A.92.92 0 0 0 2 7Z",
      key: "1y12pk",
    },
  ],
  ["path", { d: "M2 11c0 1.7 1.3 3 3 3h7", key: "1aw5u0" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/high-heel.ts · @lucide/lab 0.7.0
const highHeelNode: IconNode = [
  [
    "path",
    {
      d: "M4 3c6 6 8.4 10.5 9.8 12 .9 1 2.5 1.3 3.7.6.3-.2.5-.3.7-.6.6.3 3.8 3.1 3.8 5 0 1-1 1-1 1h-7c-1 0-2-.5-2.6-1.5L10.1 17c-.9-1.6-2.2-3-3.7-4.2L4 11a5 5 0 0 1 0-8",
      key: "1xy4gs",
    },
  ],
  ["path", { d: "m2.56 9.3.6 1.1C4.2 12.6 5 16.5 5 21", key: "tyi6z9" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/socks.ts · @lucide/lab 0.7.0
const socksNode: IconNode = [
  [
    "path",
    {
      d: "M9.6 20.4 9 21a3.38 3.38 0 1 1-4.9-4.9l3.5-3.5C8.4 11.6 9 10.4 9 9V3c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v10a5.15 5.15 0 0 1-1.5 3.6L15 21a3.38 3.38 0 1 1-4.9-4.9l3.5-3.5c.8-1 1.4-2.2 1.4-3.6V2",
      key: "7wkxk6",
    },
  ],
  ["path", { d: "M9 6h12", key: "x4ogtv" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/belt.ts · @lucide/lab 0.7.0
const beltNode: IconNode = [
  ["path", { d: "M7.3 9H3c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1h4.3", key: "1imxws" }],
  ["path", { d: "M6 6h3", key: "qh3tn0" }],
  ["path", { d: "M13 6h.01", key: "cksc78" }],
  ["rect", { width: "10", height: "8", x: "7", y: "2", rx: "2", key: "3xru4v" }],
  ["path", { d: "M16.7 3H21c.6 0 1 .4 1 1v4c0 .6-.4 1-1 1h-4.3", key: "vnlabj" }],
  ["path", { d: "m10.5 10-8.1 6.2", key: "qz383w" }],
  ["path", { d: "M21.6 8.8 12.2 16", key: "fvikpm" }],
  ["path", { d: "M3 22c-.6 0-1-.4-1-1v-4c0-.6.4-1 1-1h16l3 3-3 3Z", key: "1n2mdy" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/scarf.ts · @lucide/lab 0.7.0
const scarfNode: IconNode = [
  [
    "path",
    {
      d: "M19.5 2.5 7 15c-.5.5-.6 1.5-.2 2L9 20 21.6 7.6a2 1.7 0 0 0 .1-1.9l-2-3c-.2-.4-.7-.7-1.2-.7h-13c-.5 0-1 .3-1.2.7l-2 3a2 1.7 0 0 0 .2 2l6 5.8",
      key: "ke54ui",
    },
  ],
  ["path", { d: "M12 10 4.5 2.5", key: "l2kccz" }],
  ["path", { d: "M13 20v2", key: "1t5i3p" }],
  ["path", { d: "M16 6H8", key: "whfohi" }],
  ["path", { d: "M17 12.1V22", key: "1sn4cd" }],
  ["path", { d: "M17 18h4", key: "xlnm2s" }],
  ["path", { d: "M17 20H9v2", key: "81fvye" }],
  ["path", { d: "M21 8.2V20", key: "pnvrlw" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/hat-baseball.ts · @lucide/lab 0.7.0
const hatBaseballNode: IconNode = [
  ["path", { d: "M12 3v1", key: "1asbbs" }],
  [
    "path",
    { d: "M12 14c2.8 0 5.5.3 8 .9V12a8 8 0 0 0-16 0v2.9c2.5-.6 5.2-.9 8-.9", key: "f2b449" },
  ],
  ["path", { d: "M9 14.1V10h6v4.1", key: "17vz4k" }],
  [
    "path",
    {
      d: "M2.3 18A2 2 0 0 0 4 21h.4l1.6-.4a26.44 26.44 0 0 1 12 0l1.6.4h.4a2 2 0 0 0 1.7-3l-1.8-3.2a39.9 39.9 0 0 0-15.8 0Z",
      key: "xo2dry",
    },
  ],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/hat-beanie.ts · @lucide/lab 0.7.0
const hatBeanieNode: IconNode = [
  ["path", { d: "M10.4 6.2C6.7 6.9 4 10.1 4 14v1", key: "9387br" }],
  ["circle", { cx: "12", cy: "5", r: "2", key: "f1ur92" }],
  ["path", { d: "M20 15v-1c0-3.9-2.7-7.1-6.4-7.8", key: "1o2bc8" }],
  ["rect", { width: "20", height: "5", x: "2", y: "15", rx: "1", key: "noh35d" }],
  ["path", { d: "M6 15v5", key: "12y8bp" }],
  ["path", { d: "M10 15v5", key: "13p7r0" }],
  ["path", { d: "M14 15v5", key: "1271wn" }],
  ["path", { d: "M18 15v5", key: "hb43h5" }],
];

// src: https://unpkg.com/@lucide/lab@0.7.0/src/icons/gem-ring.ts · @lucide/lab 0.7.0
const gemRingNode: IconNode = [
  ["path", { d: "M13.2 8.1 16 4.4 14.4 2H9.6L8 4.4l2.8 3.7", key: "srrhiz" }],
  ["circle", { cx: "12", cy: "15", r: "7", key: "14w87o" }],
];

export const Trousers = createLucideIcon("trousers", trousersNode);
export const Skirt = createLucideIcon("skirt", skirtNode);
export const Shorts = createLucideIcon("shorts", shortsNode);
export const Dress = createLucideIcon("dress", dressNode);
export const Jacket = createLucideIcon("jacket", jacketNode);
export const Vest = createLucideIcon("vest", vestNode);
export const Sweater = createLucideIcon("sweater", sweaterNode);
export const Sneaker = createLucideIcon("sneaker", sneakerNode);
export const HighHeel = createLucideIcon("high-heel", highHeelNode);
export const Socks = createLucideIcon("socks", socksNode);
export const Belt = createLucideIcon("belt", beltNode);
export const Scarf = createLucideIcon("scarf", scarfNode);
export const HatBaseball = createLucideIcon("hat-baseball", hatBaseballNode);
export const HatBeanie = createLucideIcon("hat-beanie", hatBeanieNode);
export const GemRing = createLucideIcon("gem-ring", gemRingNode);

const KIND_GLYPHS: Readonly<Record<GarmentKind, LucideIcon>> = {
  top: Shirt,
  bottoms: Trousers,
  dress: Dress,
  outerwear: Jacket,
  shoes: Sneaker,
  bag: Handbag,
  jewelry: Gem,
  accessory: Tag,
  unknown: Tag,
};

/** Labels whose piece looks different from the rest of its kind. */
const LABEL_GLYPHS: Readonly<Record<string, LucideIcon>> = {
  Sweater: Sweater,
  Sweatshirt: Sweater,
  Charm: Gem,
  Cardigan: Sweater,
  Skirt: Skirt,
  Shorts: Shorts,
  Jumpsuit: Dress,
  Vest: Vest,
  Heels: HighHeel,
  Backpack: Backpack,
  Ring: GemRing,
  Watch: Watch,
  Sunglasses: Glasses,
  Socks: Socks,
  Belt: Belt,
  Scarf: Scarf,
  Cap: HatBaseball,
  Hat: HatBaseball,
  Beanie: HatBeanie,
};

export function garmentGlyph({ kind, label }: Garment): LucideIcon {
  return LABEL_GLYPHS[label] ?? KIND_GLYPHS[kind];
}
