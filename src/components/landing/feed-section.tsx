import { Reveal, RevealItem } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section";

const FEED_IMAGES = [
  { src: "/landing/feed-1.jpg", alt: "Outfit post — warm autumn palette, olive and cream" },
  { src: "/landing/feed-2.jpg", alt: "Outfit post — cool winter palette, charcoal and white" },
  { src: "/landing/feed-3.jpg", alt: "Outfit post — soft spring palette, coral sundress" },
  { src: "/landing/feed-4.jpg", alt: "Outfit post — deep summer palette, navy and blush" },
];

export function FeedSection() {
  return (
    <Reveal id="feed" stagger className="scroll-mt-16 border-t border-border py-20 sm:py-24">
      <div className="atelier-container">
        <SectionHeading
          align="center"
          heading="Post today's fit. See everyone else's."
          body="One photo, tagged automatically — every piece becomes shoppable for the whole community."
        />
      </div>

      <div className="mt-14 grid grid-cols-2 gap-1 sm:mt-16 sm:grid-cols-4 sm:gap-1.5">
        {FEED_IMAGES.map((img) => (
          <RevealItem key={img.src} className="aspect-square overflow-hidden">
            <img
              src={img.src}
              alt={img.alt}
              width={480}
              height={480}
              loading="lazy"
              className="size-full object-cover transition-transform duration-200 ease-editorial hover:scale-[1.03]"
            />
          </RevealItem>
        ))}
      </div>
    </Reveal>
  );
}
