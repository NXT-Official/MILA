import { Brush, Scissors, Shirt, Sparkles, type LucideIcon } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
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

  return (
    <Reveal id="top" className="relative isolate pb-20 pt-16 sm:pb-28 sm:pt-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-48 -z-10 mx-auto h-[26rem] max-w-2xl rounded-full bg-accent/15 blur-[130px]"
      />

      <div className="atelier-container">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3.5 py-1.5 text-label font-semibold uppercase tracking-label text-ink">
            <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
            {content.kicker}
          </span>

          <h1 className="mt-8 text-[clamp(3rem,8vw,5rem)] leading-[0.95]">
            {content.headlineLine1}
            <br />
            <span className="text-muted-foreground">{content.headlineLine2}</span>
          </h1>

          <p className="mx-auto mt-7 max-w-lg text-lg leading-relaxed text-pretty text-muted-foreground">
            {content.subhead}
          </p>

          <div className="mt-10 flex flex-col items-center gap-3.5">
            <CtaButton className="w-full sm:w-auto" />
            <span className="text-xs text-muted-foreground">{content.ctaNote}</span>
          </div>
        </div>

        {/* The artifact: one composed look, laid out as the product panel itself. */}
        <div className="mx-auto mt-20 max-w-5xl sm:mt-24">
          <div className="overflow-hidden rounded-card border border-border bg-surface shadow-raised">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4 sm:px-8">
              <SeasonTag season={preview.season} />
              <span className="text-micro uppercase tracking-label-wide text-muted-foreground">
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
        </div>
      </div>
    </Reveal>
  );
}
