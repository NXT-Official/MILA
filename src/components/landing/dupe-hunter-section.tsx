import { BadgeCheck, Camera } from "lucide-react";
import { Section, SectionHeading, Eyebrow } from "@/components/landing/section";
import { cn } from "@/lib/utils";
import type { DupeCard, DupeHunterContent } from "@/lib/landing-content";

function DupeColumn({ card, isMatch }: { card: DupeCard; isMatch?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-1 min-w-0 flex-col gap-3 p-8 sm:p-10",
        isMatch && "bg-accent-soft/50",
      )}
    >
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
        <div className="order-last flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-paper sm:flex-row sm:divide-x sm:divide-y-0 lg:order-first">
          <DupeColumn card={content.inspiration} />
          <DupeColumn card={content.milaMatch} isMatch />
        </div>

        <SectionHeading kicker={content.kicker} heading={content.heading} body={content.body} />
      </div>
    </Section>
  );
}
