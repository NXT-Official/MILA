import { Quote } from "lucide-react";
import { SeasonTag } from "@/components/landing/season-tag";
import type { Testimonial } from "@/lib/landing-content";

export function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  return (
    <ul className="mt-14 grid gap-5 sm:mt-16 sm:grid-cols-2 lg:grid-cols-3">
      {testimonials.map((t) => (
        <li key={t._key}>
          <figure className="flex h-full flex-col rounded-card border border-border bg-surface p-8 transition-[transform,border-color,box-shadow] duration-200 ease-editorial hover:-translate-y-1 hover:border-accent hover:shadow-paper">
            <Quote
              className="size-5 shrink-0 fill-accent/25 text-accent"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <blockquote className="mt-5 flex-1 font-serif text-lg leading-snug text-pretty text-foreground">
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
