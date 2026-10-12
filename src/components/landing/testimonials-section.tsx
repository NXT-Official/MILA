import { Quote } from "lucide-react";
import { SeasonTag } from "@/components/landing/season-tag";
import type { Testimonial } from "@/lib/landing-content";

/**
 * Member quotes in two balanced columns (one on phones), each quote kept whole.
 * Any number of quotes settles without the ragged last row a three-column grid
 * gave five of them, and it no longer repeats the How it works layout.
 */
export function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  return (
    <ul className="mt-14 gap-6 sm:mt-16 sm:columns-2">
      {testimonials.map((t) => (
        <li
          key={t._key}
          className="mb-6 break-inside-avoid rounded-card border border-border bg-card p-6 sm:p-8"
        >
          <figure className="flex flex-col gap-4">
            <Quote
              className="size-8 shrink-0 fill-accent/20 text-accent"
              strokeWidth={1}
              aria-hidden="true"
            />
            <blockquote className="font-serif text-lg leading-snug text-pretty text-foreground">
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
