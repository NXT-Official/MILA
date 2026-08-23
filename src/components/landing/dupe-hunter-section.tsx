import { BadgeCheck } from "lucide-react";
import { Section, SectionHeading, Eyebrow } from "@/components/landing/section";
import { cn } from "@/lib/utils";
import type { DupeCard, DupeHunterContent } from "@/lib/landing-content";

function DupeRow({ card, isMatch }: { card: DupeCard; isMatch?: boolean }) {
  return (
    // No `flex-wrap`: wrapped, the price dropped under the title and lost the
    // side-by-side reading that is the whole point of the row. It stays on the
    // line and steps down a size on a phone instead.
    <div className="flex items-baseline justify-between gap-x-6 py-7 sm:gap-x-8">
      <div>
        {/* The check appears once, on the match. The other row needs no icon to
            say what it is — the struck price says it. */}
        <Eyebrow
          icon={isMatch ? BadgeCheck : undefined}
          className={isMatch ? "text-ink" : undefined}
        >
          {card.label}
        </Eyebrow>
        <p className="mt-2.5 max-w-[28ch] text-lg leading-snug tracking-[-0.01em] text-balance text-foreground">
          {card.title}
        </p>
      </div>
      <p
        className={cn(
          "shrink-0 text-2xl tracking-[-0.02em] tabular-nums sm:text-3xl",
          isMatch ? "text-foreground" : "text-muted-foreground line-through decoration-1",
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
      <div className="grid items-center gap-16 lg:grid-cols-[6fr_5fr] lg:gap-24">
        {/* Two prices, one rule between them. The comparison is the whole point,
            so nothing else — no panel, no tinted "winner" fill — competes with
            the difference between the two numbers. */}
        <div className="order-last divide-y divide-line border-y border-line lg:order-first">
          <DupeRow card={content.inspiration} />
          <DupeRow card={content.milaMatch} isMatch />
        </div>

        <SectionHeading heading={content.heading} body={content.body} />
      </div>
    </Section>
  );
}
