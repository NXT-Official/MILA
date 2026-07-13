import { Star } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";
import { TESTIMONIALS } from "@/constants/landing";

export function TestimonialsSection() {
  return (
    <Reveal className="mx-auto w-full max-w-6xl px-6 pb-24">
      <div className="flex snap-x gap-4 overflow-x-auto pb-2">
        {TESTIMONIALS.map((t) => (
          <figure key={t.name} className="atelier-card w-72 shrink-0 snap-start p-5">
            <div className="flex gap-0.5 text-accent" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="size-3.5 fill-current" />
              ))}
            </div>
            <blockquote className="mt-3 font-serif text-base leading-snug text-foreground">
              "{t.quote}"
            </blockquote>
            <figcaption className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              {t.name} <SeasonTag season={t.season} />
            </figcaption>
          </figure>
        ))}
      </div>
    </Reveal>
  );
}
