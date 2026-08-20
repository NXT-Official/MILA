import { motion, useReducedMotion } from "framer-motion";
import { Brush, Scissors, Shirt, Sparkles, type LucideIcon } from "lucide-react";
import { SeasonTag } from "@/components/landing/season-tag";
import { CtaButton } from "@/components/landing/cta-button";
import { Eyebrow } from "@/components/landing/section";
import type { HeroContent } from "@/lib/landing-content";

function Facet({ label, value, icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="flex-1 p-8">
      <Eyebrow icon={icon}>{label}</Eyebrow>
      <p className="mt-3 text-base leading-relaxed text-foreground">{value}</p>
    </div>
  );
}

export function HeroSection({ content }: { content: HeroContent }) {
  const { preview } = content;
  const reduce = useReducedMotion() ?? false;

  /**
   * The page's one orchestrated moment: the hero settles on load, in reading
   * order, and nothing else on the page announces itself this way.
   *
   * `y` only — never opacity. If rAF never runs (hidden tab, headless render)
   * the content is simply a few pixels low rather than invisible.
   */
  const rise = (step: number) => ({
    initial: { y: 14 },
    animate: { y: 0 },
    transition: {
      duration: reduce ? 0 : 0.55,
      delay: reduce ? 0 : step * 0.07,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  });

  return (
    <section id="top" className="pb-20 pt-16 sm:pb-28 sm:pt-24">
      <div className="atelier-container">
        <div className="mx-auto max-w-3xl text-center">
          <motion.span
            {...rise(0)}
            className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3.5 py-1.5 text-label font-semibold uppercase tracking-label text-ink"
          >
            <Sparkles className="size-3.5 text-ink" aria-hidden="true" />
            {content.kicker}
          </motion.span>

          <motion.h1 {...rise(1)} className="mt-8 text-[clamp(2.5rem,6vw,3.5rem)] leading-[1]">
            {content.headlineLine1}
            <br />
            <span className="text-muted-foreground">{content.headlineLine2}</span>
          </motion.h1>

          <motion.p
            {...rise(2)}
            className="mx-auto mt-7 max-w-lg text-lg leading-relaxed text-pretty text-muted-foreground"
          >
            {content.subhead}
          </motion.p>

          <motion.div {...rise(3)} className="mt-10 flex flex-col items-center gap-3.5">
            <CtaButton className="w-full sm:w-auto" />
            <span className="text-xs text-muted-foreground">{content.ctaNote}</span>
          </motion.div>
        </div>

        {/* The artifact: one composed look, laid out as the product panel itself.
            It arrives last, so the pitch reads before the proof. */}
        <motion.div {...rise(4)} className="mt-20 sm:mt-24">
          <div className="overflow-hidden rounded-card border border-border bg-surface shadow-paper">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4 sm:px-8">
              <SeasonTag season={preview.season} />
              <span className="text-label font-semibold uppercase tracking-label text-muted-foreground">
                {preview.weather}
              </span>
            </div>

            <div className="grid lg:grid-cols-[1.6fr_1fr]">
              <div className="p-8 sm:p-12">
                <Eyebrow icon={Shirt}>Outfit</Eyebrow>
                <p className="mt-4 font-serif text-[clamp(1.625rem,3.2vw,2.25rem)] leading-[1.15] text-balance text-foreground">
                  {preview.outfitTitle}
                </p>
                <p className="mt-5 max-w-md text-base leading-relaxed text-pretty text-muted-foreground">
                  {preview.outfitBody}
                </p>
              </div>

              <div className="flex flex-col divide-y divide-border border-t border-border lg:border-l lg:border-t-0">
                <Facet label="Hair" value={preview.hair} icon={Scissors} />
                <Facet label="Makeup" value={preview.makeup} icon={Brush} />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
