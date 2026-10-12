import { UserRound, WandSparkles, Users } from "lucide-react";
import { Section, SectionHeading, IconTile } from "@/components/landing/section";
import { RevealItem } from "@/components/landing/reveal";
import type { HowItWorksContent } from "@/lib/landing-content";

const STEP_ICONS = [UserRound, WandSparkles, Users];

/**
 * Steps as rows (title beside its body), led by their real titles. The list
 * keeps the order, so the Studio's step `number` is not shown; the field stays
 * in the content for the Studio.
 */
export function HowItWorksSection({ content }: { content: HowItWorksContent }) {
  return (
    <Section id="how-it-works" stagger>
      <SectionHeading heading={content.heading} />

      <ol className="mt-14 divide-y divide-border border-t border-border sm:mt-16">
        {content.steps.map((step, i) => (
          <RevealItem
            key={step._key}
            as="li"
            className="grid gap-4 py-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start md:gap-12 md:py-10"
          >
            <div className="flex items-center gap-4">
              <IconTile icon={STEP_ICONS[i % STEP_ICONS.length]} size="sm" />
              <h3 className="font-serif text-2xl leading-snug text-foreground">{step.title}</h3>
            </div>
            <p className="max-w-[60ch] text-base leading-relaxed text-pretty text-muted-foreground md:pt-1.5 md:text-lg">
              {step.body}
            </p>
          </RevealItem>
        ))}
      </ol>
    </Section>
  );
}
