import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";
import { CtaButton } from "@/components/landing/cta-button";
import type { CtaContent, HeroContent } from "@/lib/landing-content";

/**
 * Two Studio lines joined into one paragraph each need to end a sentence: the
 * note was written to stand alone under the button ("Takes under a minute").
 */
function asSentence(line: string) {
  return /[.!?…]["”']?$/.test(line) ? line : `${line}.`;
}

export function HeroSection({ content, cta }: { content: HeroContent; cta?: CtaContent }) {
  const { preview } = content;
  const reduce = useReducedMotion() ?? false;

  return (
    <Reveal id="top" className="relative isolate pb-20 pt-16 sm:pb-28 sm:pt-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-48 -z-10 mx-auto h-[26rem] max-w-2xl rounded-full bg-accent/15 blur-[130px]"
      />

      <div className="atelier-container">
        <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3.5 py-1.5 text-label font-semibold uppercase tracking-label text-ink">
              <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
              {content.kicker}
            </span>

            <h1 className="landing-hero-heading mt-8 text-foreground">
              {content.headlineLine1}
              <br />
              <span className="text-muted-foreground">{content.headlineLine2}</span>
            </h1>

            {/* The Studio's "note under the button" closes the sub-copy: the hero
                keeps one line of support copy and nothing under its CTA. */}
            <p className="mt-7 max-w-lg text-lg leading-relaxed text-pretty text-muted-foreground">
              {`${asSentence(content.subhead)} ${asSentence(content.ctaNote)}`}
            </p>

            <div className="mt-10">
              <CtaButton className="w-full sm:w-auto" labels={cta} />
            </div>
          </div>

          {/* The artifact: a real identity-locked style sheet, the product's own output. */}
          <div className="border-t border-border pt-8 lg:border-t-0 lg:border-l lg:pl-14 lg:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
              <SeasonTag season={preview.season} />
              <span className="text-micro uppercase tracking-label-wide text-muted-foreground">
                {preview.weather}
              </span>
            </div>

            <div className="py-5">
              <motion.img
                src={content.image.src}
                alt={content.image.alt}
                width={1686}
                height={1128}
                loading="eager"
                fetchPriority="high"
                className="w-full rounded-card border border-border shadow-paper"
                // The hero image is the page's likely LCP element: starting it
                // at opacity 0 on the server keeps the largest paint hidden
                // until hydration (and forever without JS). Settle-in with
                // transform only — the art is never invisible (Morpessa MW-14).
                initial={reduce ? false : { scale: 0.97 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              />
              <p className="mt-3 text-micro uppercase tracking-label-xwide text-muted-foreground">
                {content.imageCaption}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
