import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";
import { CtaButton } from "@/components/landing/cta-button";

export function HeroSection() {
  return (
    <Reveal className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pb-20 pt-10 sm:pt-16 lg:grid-cols-2">
      <div>
        <p className="atelier-kicker">Your AI stylist</p>
        <h1 className="atelier-title mt-3 text-[clamp(2.75rem,7vw,4.25rem)]">
          Your stylist.
          <br />
          Every morning.
        </h1>
        <p className="mt-5 max-w-md text-base leading-relaxed">
          Mila composes your daily look around your colour season, your silhouette, and the weather
          outside. Personalised guidance — without the appointment.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <CtaButton />
          <span className="text-xs text-muted-foreground">Takes under a minute</span>
        </div>
      </div>

      <div className="atelier-card relative overflow-hidden p-7 sm:p-9">
        <div
          className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-accent/25 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <div className="flex items-center justify-between">
            <SeasonTag season="True Summer" />
            <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              18°C · Light rain
            </span>
          </div>
          <p className="atelier-kicker mt-6">Outfit</p>
          <h3 className="mt-1 font-serif text-2xl leading-snug text-foreground">
            Slate trench over a dove-grey knit
          </h3>
          <p className="mt-2 text-sm leading-relaxed">
            Cool, muted layers carry your palette through the rain — soft charcoal trousers keep the
            line long.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-6 border-t border-border pt-5">
            <div>
              <p className="atelier-kicker">Hair</p>
              <p className="mt-1 text-sm text-foreground">Low knot, centre part — humidity-proof</p>
            </div>
            <div>
              <p className="atelier-kicker">Makeup</p>
              <p className="mt-1 text-sm text-foreground">Rose-beige lip, cool taupe lid</p>
            </div>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
