import { BadgeCheck, Camera } from "lucide-react";
import { Section, SectionHeading, Eyebrow } from "@/components/landing/section";
import { cn } from "@/lib/utils";
import type { DupeCard, DupeHunterContent } from "@/lib/landing-content";

function DupeRow({ card, isMatch }: { card: DupeCard; isMatch?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-8 sm:p-10",
        isMatch && "bg-accent-soft/50",
      )}
    >
      <div>
        <Eyebrow icon={isMatch ? BadgeCheck : Camera} className={isMatch ? "text-ink" : undefined}>
          {card.label}
        </Eyebrow>
        <p className="mt-3 font-serif text-xl leading-snug text-balance text-foreground">
          {card.title}
        </p>
      </div>
      <p
        className={cn(
          "font-serif text-3xl",
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
        <div className="order-last divide-y divide-border overflow-hidden rounded-card border border-border bg-surface transition-shadow duration-200 ease-editorial hover:shadow-paper lg:order-first">
          <DupeRow card={content.inspiration} />
          <DupeRow card={content.milaMatch} isMatch />
        </div>

        <SectionHeading kicker={content.kicker} heading={content.heading} body={content.body} />
      </div>
    </Section>
  );
}
