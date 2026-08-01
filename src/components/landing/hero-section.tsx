import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";
import { CtaButton } from "@/components/landing/cta-button";
import { Card } from "@/components/ui/card";
import type { HeroContent } from "@/lib/landing-content";

export function HeroSection({ content }: { content: HeroContent }) {
  const { preview } = content;

  return (
    <Reveal className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pb-20 pt-10 sm:pt-16 lg:grid-cols-2">
      <div>
        <p className="atelier-kicker">{content.kicker}</p>
        <h1 className="atelier-title mt-3 text-[clamp(2.75rem,7vw,4.25rem)]">
          {content.headlineLine1}
          <br />
          {content.headlineLine2}
        </h1>
        <p className="mt-5 max-w-md text-base leading-relaxed">{content.subhead}</p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <CtaButton />
          <span className="text-xs text-muted-foreground">{content.ctaNote}</span>
        </div>
      </div>

      <Card className="relative overflow-hidden p-7 sm:p-9">
        <div
          className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-accent/25 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <div className="flex items-center justify-between">
            <SeasonTag season={preview.season} />
            <span className="text-micro uppercase tracking-label-wide text-muted-foreground">
              {preview.weather}
            </span>
          </div>
          <p className="atelier-kicker mt-6">Outfit</p>
          <h3 className="mt-1 font-serif text-2xl leading-snug text-foreground">
            {preview.outfitTitle}
          </h3>
          <p className="mt-2 text-sm leading-relaxed">{preview.outfitBody}</p>
          <div className="mt-6 grid grid-cols-2 gap-6 border-t border-border pt-5">
            <div>
              <p className="atelier-kicker">Hair</p>
              <p className="mt-1 text-sm text-foreground">{preview.hair}</p>
            </div>
            <div>
              <p className="atelier-kicker">Makeup</p>
              <p className="mt-1 text-sm text-foreground">{preview.makeup}</p>
            </div>
          </div>
        </div>
      </Card>
    </Reveal>
  );
}
