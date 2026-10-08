/**
 * The home page's "read your colors, compose the look, shop it" stack.
 *
 * The step names and the shop panel's copy live in code for now: the Studio
 * schema has no field for them, and the palette and concierge copy inside the
 * panels still comes from the Studio. Moving these into the Studio needs a new
 * schema group (owner follow-up), the same way section order is code-owned.
 */

export type StyleFlowStep = "palette" | "compose" | "shop";

/** Each step's name, as a panel title and as a clause of the stack heading. */
export const STYLE_FLOW_STEPS: Record<StyleFlowStep, { title: string; clause: string }> = {
  palette: { title: "Read your colors", clause: "read your colors" },
  compose: { title: "Compose the look", clause: "compose the look" },
  shop: { title: "Shop it", clause: "shop it" },
};

/**
 * The shop panel. Look products are ranked by palette and body-shape match
 * (`src/lib/look-products.functions.ts`), and shop links are `rel="sponsored"`,
 * so the commission line is the honest disclosure.
 */
export const STYLE_FLOW_SHOP = {
  heading: "Every piece, ready to buy.",
  body: "Each look comes with pieces you can buy, ranked for your season and your shape. Some shop links earn Mila a commission.",
};

/** "Read your colors, compose the look, shop it." for the steps shown, in order. */
export function styleFlowHeading(steps: StyleFlowStep[]): string {
  const sentence = steps.map((step) => STYLE_FLOW_STEPS[step].clause).join(", ");
  return sentence ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.` : "";
}
