import { Quote } from "lucide-react";
import { SeasonTag } from "@/components/landing/season-tag";
import type { Testimonial } from "@/lib/landing-content";

export function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  return (
    <ul className="mt-14 divide-y divide-border border-t border-border sm:mt-16 md:grid md:grid-cols-3 md:divide-y-0 md:divide-x md:border-b">
      {testimonials.map((t) => (
        <li key={t._key} className="py-8 md:px-8 md:py-10 first:md:pl-0 last:md:pr-0">
          <figure className="flex h-full flex-col gap-4">
            <Quote
              className="size-8 shrink-0 fill-accent/20 text-accent"
              strokeWidth={1}
              aria-hidden="true"
            />
            <blockquote className="flex-1 font-serif text-lg leading-snug text-pretty text-foreground">
              &ldquo;{t.quote}&rdquo;
            </blockquote>
            <figcaption className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
              {t.name} <SeasonTag season={t.season} />
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
