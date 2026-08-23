import type { Testimonial } from "@/lib/landing-content";

/* ponytail: four stock portraits in /public/profiles, dealt round-robin. The
   Sanity testimonial has no avatar field, so nothing here claims to be a photo
   of the person quoted — hence the empty alt. Add an `image` to the schema and
   read it here when real member portraits exist. */
const AVATARS = [
  "/profiles/profile1.png",
  "/profiles/profile2.png",
  "/profiles/profile3.png",
  "/profiles/profile4.png",
];

export function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  return (
    // A real grid, not CSS `columns`. Multi-column fills column one to the
    // bottom before starting column two, so with five entries the third column
    // began lower than the first and every card ended a different height — the
    // cells never lined up. Grid rows align, and `h-full` below squares the
    // cards off against the tallest quote in their row.
    <ul className="mt-20 grid gap-5 sm:mt-24 sm:grid-cols-2 lg:grid-cols-3">
      {testimonials.map((t, i) => (
        <li key={t._key}>
          {/* A tint of ink rather than a solid surface: it lifts off the ground
              at both ends of the theme — warm grey on cream, a pale rise on
              near-black — and stays translucent enough to keep the reel behind
              it. No border; the fill alone is the edge. */}
          <figure className="relative flex h-full flex-col rounded-overlay bg-ink/[0.05] p-6 ring-1 ring-line sm:p-7">
            <figcaption>
              <img
                src={AVATARS[i % AVATARS.length]}
                alt=""
                width={48}
                height={48}
                loading="lazy"
                decoding="async"
                className="size-12 rounded-full object-cover ring-1 ring-ink/10"
              />
              <span className="mt-4 block text-sm font-semibold text-foreground">{t.name}</span>
            </figcaption>

            <blockquote className="mt-5 text-sm leading-[1.7] text-pretty text-muted-foreground">
              {t.quote}
            </blockquote>

            {/* The mark does the quoting, so the text no longer carries its own
                curly quotes — one job each. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-6 top-5 select-none text-4xl leading-none text-ink/15"
            >
              &rdquo;
            </span>
          </figure>
        </li>
      ))}
    </ul>
  );
}
