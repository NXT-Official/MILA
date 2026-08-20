import { SeasonTag } from "@/components/landing/season-tag";
import type { Testimonial } from "@/lib/landing-content";

export function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  return (
    // Multi-column flow rather than a grid: quotes are uneven lengths and the
    // count is CMS-driven, so a grid always leaves an orphan row. Columns don't.
    <ul className="mt-20 gap-5 sm:mt-24 sm:columns-2 lg:columns-3">
      {testimonials.map((t) => (
        <li key={t._key} className="mb-5 break-inside-avoid">
          <figure className="rounded-card border border-border bg-surface p-8">
            <blockquote className="font-serif text-lg leading-snug text-pretty text-foreground">
              &ldquo;{t.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-7 flex flex-wrap items-center gap-2.5 border-t border-border pt-5 text-sm text-muted-foreground">
              {t.name} <SeasonTag season={t.season} />
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
