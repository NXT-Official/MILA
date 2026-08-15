import { cn } from "@/lib/utils";
import { BODIES, FACE_SHAPES, HAIR_TYPES } from "@/constants/style-profile";

/**
 * Line diagrams for the three shape-based dossier attributes. These values are a
 * fixed, enumerable set, so the whole library is static — nothing here is
 * generated per member.
 *
 * ponytail: inline SVG paths rather than an asset library. They inherit
 * `currentColor` (so they theme for free) and cost no request. Swap for real
 * illustration files if the drawings ever need more fidelity than an outline.
 */

/**
 * Body shapes differ only in three widths, so the outline is derived from them
 * rather than hand-drawn five times. Half-widths at shoulder, waist and hip.
 */
function bodyPath(shoulder: number, waist: number, hip: number): string {
  const [sL, sR] = [12 - shoulder, 12 + shoulder];
  const [wL, wR] = [12 - waist, 12 + waist];
  const [hL, hR] = [12 - hip, 12 + hip];
  return [
    `M${sL} 6`,
    `Q${sL} 11 ${wL} 16`,
    `Q${hL} 21 ${hL} 25`,
    `L${hL} 28`,
    `H${hR}`,
    `L${hR} 25`,
    `Q${hR} 21 ${wR} 16`,
    `Q${sR} 11 ${sR} 6`,
    "Z",
  ].join(" ");
}

const SILHOUETTE_PATHS: Record<string, string> = {
  Hourglass: bodyPath(8, 4.5, 8),
  // Dead straight — any waist pinch here reads as a soft hourglass instead.
  Rectangle: bodyPath(7, 7, 7),
  Pear: bodyPath(5.5, 5.5, 9),
  "Inverted Triangle": bodyPath(9, 6, 5),
  // The widest point has to be the middle, and by enough to see at 24px.
  Apple: bodyPath(6.8, 9.2, 7.2),
};

/**
 * Faces are distinguished by where the width sits, so the pairs that could blur
 * together are pushed apart: Oval tapers to a narrower jaw, Oblong keeps one
 * width but runs the full height of the box.
 */
const FACE_PATHS: Record<string, string> = {
  Oval: "M12 5 Q19 5 18.5 15 Q18 27 12 27 Q6 27 5.5 15 Q5 5 12 5 Z",
  Round: "M12 5.5 Q20.5 5.5 20.5 16 Q20.5 26.5 12 26.5 Q3.5 26.5 3.5 16 Q3.5 5.5 12 5.5 Z",
  Square: "M5 9 Q5 5.5 8.5 5.5 H15.5 Q19 5.5 19 9 V21 Q19 26.5 15.5 26.5 H8.5 Q5 26.5 5 21 Z",
  Heart: "M4.5 11 Q4.5 5.5 12 5.5 Q19.5 5.5 19.5 11 Q19.5 19 12 27 Q4.5 19 4.5 11 Z",
  Diamond: "M12 4.5 Q16 8.5 19 16 Q16 23.5 12 27.5 Q8 23.5 5 16 Q8 8.5 12 4.5 Z",
  Oblong: "M12 3 Q17.5 3 17.5 14 V18 Q17.5 29 12 29 Q6.5 29 6.5 18 V14 Q6.5 3 12 3 Z",
};

/**
 * Each texture is one strand shape, repeated across three x positions. The four
 * read as a progression — flat, open S, closed loop, tight zigzag — so amplitude
 * and period have to step up visibly between them.
 */
const HAIR_STRAND: Record<string, (x: number) => string> = {
  "Straight/Fine": (x) => `M${x} 6 V26`,
  Wavy: (x) => `M${x} 6 q2.6 3.3 0 6.6 q-2.6 3.3 0 6.6 q2.6 3.3 0 6.6`,
  Curly: (x) => `M${x} 6 q4.6 2 0 4 q-4.6 2 0 4 q4.6 2 0 4 q-4.6 2 0 4 q4.6 2 0 4`,
  "Coily/Textured": (x) =>
    `M${x} 6 l2.2 2.5 l-2.2 2.5 l2.2 2.5 l-2.2 2.5 l2.2 2.5 l-2.2 2.5 l2.2 2.5 l-2.2 2.5`,
};

export type DiagramKind = "silhouette" | "face" | "hair";

/**
 * Renders the diagram for one attribute value, or nothing when the value is
 * unset or unrecognised — a missing drawing must never break the row it sits in.
 */
export function AttributeDiagram({
  kind,
  value,
  className,
}: {
  kind: DiagramKind;
  value?: string | null;
  className?: string;
}) {
  if (!value) return null;

  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const svgProps = {
    viewBox: "0 0 24 32",
    "aria-hidden": true,
    className: cn("h-8 w-6 shrink-0 text-foreground/70", className),
  };

  if (kind === "hair") {
    const strand = HAIR_STRAND[value];
    if (!strand) return null;
    return (
      <svg {...svgProps}>
        {[5, 12, 19].map((x) => (
          <path key={x} d={strand(x)} {...stroke} />
        ))}
      </svg>
    );
  }

  const d = kind === "face" ? FACE_PATHS[value] : SILHOUETTE_PATHS[value];
  if (!d) return null;
  return (
    <svg {...svgProps}>
      <path d={d} {...stroke} />
    </svg>
  );
}

/** Exported for the coverage test — every enumerated value needs a drawing. */
export const DIAGRAM_COVERAGE = {
  silhouette: { values: BODIES, paths: SILHOUETTE_PATHS },
  face: { values: FACE_SHAPES, paths: FACE_PATHS },
  hair: { values: HAIR_TYPES, paths: HAIR_STRAND },
} as const;
