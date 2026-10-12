import { Reveal, RevealItem } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section";
import type { FeedContent } from "@/lib/landing-content";

export function FeedSection({ content }: { content: FeedContent }) {
  return (
    <Reveal id="feed" stagger className="scroll-mt-16 border-t border-border py-20 sm:py-24">
      <div className="atelier-container">
        <SectionHeading heading={content.heading} body={content.body} />
      </div>

      <div className="mt-14 grid grid-cols-2 gap-1 sm:mt-16 sm:grid-cols-4 sm:gap-1.5">
        {content.images.map((img) => (
          <RevealItem key={img._key} className="aspect-square overflow-hidden">
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
