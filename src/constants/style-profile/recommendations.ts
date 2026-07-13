import type { BodyType } from "./types";

export const BODY_TYPE_INFO: Record<BodyType, { tagline: string; description: string }> = {
  Hourglass: {
    tagline: "Balanced curves with a defined waist.",
    description:
      "Your shoulders and hips are roughly equal, with a noticeably narrower waist. Emphasize your waistline with fitted styles, wrap dresses, and belted silhouettes. Avoid boxy cuts that hide your natural curve.",
  },
  Rectangle: {
    tagline: "A straight, athletic silhouette.",
    description:
      "Your shoulders, waist, and hips are fairly aligned. Create curves with ruffles, peplum, and structured jackets. High-waisted bottoms and layered tops add dimension to your frame.",
  },
  Pear: {
    tagline: "Narrower shoulders, fuller hips.",
    description:
      "Your hips are wider than your shoulders. Balance your silhouette by drawing attention upward with statement necklines, structured shoulders, and eye-catching tops. A-line skirts work beautifully.",
  },
  "Inverted Triangle": {
    tagline: "Broader shoulders, narrower hips.",
    description:
      "Your shoulders are wider than your hips. Soften the upper body with V-necks and fluid fabrics, while adding volume below with flared pants and A-line skirts.",
  },
  Apple: {
    tagline: "Weight centered in the midsection.",
    description:
      "Your midsection is your fullest area with slimmer legs and hips. Draw the eye upward with empire waists and open necklines, while highlighting your legs with straight or slim-cut trousers.",
  },
};
