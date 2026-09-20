import { Sparkles } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";
import { CtaButton } from "@/components/landing/cta-button";
import type { HeroContent } from "@/lib/landing-content";

export function HeroSection({ content }: { content: HeroContent }) {
  const { preview } = content;

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

            <p className="mt-7 max-w-lg text-lg leading-relaxed text-pretty text-muted-foreground">
              {content.subhead}
            </p>

            <div className="mt-10 flex flex-col items-start gap-3.5">
              <CtaButton className="w-full sm:w-auto" />
              <span className="text-xs text-muted-foreground">{content.ctaNote}</span>
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
              <img
                src="/hero-style-sheet.png"
                alt="Identity-locked 5-view style sheet — face close-up, front, back, left profile, and right profile"
                width={1686}
                height={1128}
                className="w-full rounded-card border border-border shadow-paper"
              />
              <p className="mt-3 text-micro uppercase tracking-label-xwide text-muted-foreground">
                Identity-locked style sheet — five angles, one you
              </p>
            </div>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
