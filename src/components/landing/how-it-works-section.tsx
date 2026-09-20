import { UserRound, WandSparkles, Users } from "lucide-react";
import { Section, SectionHeading, IconTile } from "@/components/landing/section";
import type { HowItWorksContent } from "@/lib/landing-content";

const STEP_ICONS = [UserRound, WandSparkles, Users];

export function HowItWorksSection({ content }: { content: HowItWorksContent }) {
  return (
    <Section id="how-it-works">
      <SectionHeading align="center" kicker={content.kicker} heading={content.heading} />

      <ol className="mt-14 divide-y divide-border border-t border-border sm:mt-16 md:grid md:grid-cols-3 md:divide-y-0 md:divide-x md:border-b">
        {content.steps.map((step, i) => (
          <li
            key={step._key}
            className="flex flex-col gap-4 py-8 md:px-8 md:py-10 first:md:pl-0 last:md:pr-0"
          >
            <div className="flex items-center gap-3">
              <span className="font-serif text-4xl leading-none text-muted-foreground/50">
                {step.number}
              </span>
              <IconTile icon={STEP_ICONS[i % STEP_ICONS.length]} size="sm" />
            </div>
            <h3 className="font-serif text-2xl leading-snug text-foreground">{step.title}</h3>
            <p className="text-base leading-relaxed text-pretty text-muted-foreground">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
