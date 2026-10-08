import { BadgeCheck, Camera } from "lucide-react";
import { Section, SectionHeading, Eyebrow } from "@/components/landing/section";
import { cn } from "@/lib/utils";
import type { DupeCard, DupeHunterContent } from "@/lib/landing-content";

/**
 * The inspiration photo is framed from its right edge: the built-in one is a
 * wide editorial shot with the model on the right. A 4:5 upload fills the
 * frame either way, so the framing only matters for a wider photo.
 */
function DupeColumn({ card, isMatch }: { card: DupeCard; isMatch?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-1 min-w-0 flex-col gap-3 p-8 sm:p-10",
        isMatch && "bg-accent-soft/50",
      )}
    >
      <img
        src={card.image.src}
        alt={card.image.alt}
        width={480}
        height={600}
        loading="lazy"
        className={cn(
          "aspect-4/5 w-full rounded-panel border border-border object-cover",
          !isMatch && "object-right",
        )}
      />
      <Eyebrow icon={isMatch ? BadgeCheck : Camera} className={isMatch ? "text-ink" : undefined}>
        {card.label}
      </Eyebrow>
      <p className="font-serif text-xl leading-snug text-balance text-foreground">{card.title}</p>
      <p
        className={cn(
          "mt-auto font-serif text-3xl",
          isMatch ? "text-foreground" : "text-muted-foreground line-through",
        )}
      >
        {card.price}
      </p>
    </div>
  );
}

export function DupeHunterSection({ content }: { content: DupeHunterContent }) {
  return (
    <Section id="dupe-hunter">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <div className="order-last flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-paper transition-shadow duration-200 ease-editorial hover:shadow-raised sm:flex-row sm:divide-x sm:divide-y-0 lg:order-first">
          <DupeColumn card={content.inspiration} />
          <DupeColumn card={content.milaMatch} isMatch />
        </div>

        <SectionHeading heading={content.heading} body={content.body} />
      </div>
    </Section>
  );
}
