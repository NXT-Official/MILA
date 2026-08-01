import { createServerFn } from "@tanstack/react-start";
import type { LandingContent } from "@/lib/landing-content";

const LANDING_QUERY = `*[_id == "landingPage"][0]{
  hero{
    kicker, headlineLine1, headlineLine2, subhead, ctaNote,
    preview{season, weather, outfitTitle, outfitBody, hair, makeup}
  },
  testimonials[]{_key, name, season, quote},
  howItWorks{kicker, heading, steps[]{_key, number, title, body}},
  dossier{
    kicker, heading, body, cardTitle, season,
    rows[]{_key, label, value},
    completionLabel, completionPercent
  },
  dupeHunter{
    kicker, heading, body,
    inspiration{label, title, price},
    milaMatch{label, title, price}
  },
  community{kicker, heading, body, seasonChips},
  finalCta{heading, body, privacyNote},
  footer{wordmark, tagline}
}`;

export const getLandingContent = createServerFn({ method: "GET" }).handler(
  async (): Promise<LandingContent> => {
    const { sanity } = await import("@/lib/sanity.server");
    const content = await sanity.fetch<LandingContent | null>(LANDING_QUERY);
    if (!content) throw new Error("Landing page content is missing from Sanity.");
    return content;
  },
);
