import { UserRound, WandSparkles, Users } from "lucide-react";
import { Section, SectionHeading, Eyebrow, IconTile } from "@/components/landing/section";
import type { HowItWorksContent } from "@/lib/landing-content";

const STEP_ICONS = [UserRound, WandSparkles, Users];

export function HowItWorksSection({ content }: { content: HowItWorksContent }) {
  return (
    <Section id="how-it-works">
      <SectionHeading align="center" kicker={content.kicker} heading={content.heading} />

      <ol className="mt-14 grid gap-5 sm:mt-16 sm:grid-cols-2 lg:grid-cols-3">
        {content.steps.map((step, i) => (
          <li key={step._key}>
            <div className="group flex h-full flex-col rounded-card border border-border bg-surface p-8 transition-[transform,border-color,box-shadow] duration-200 ease-editorial hover:-translate-y-1 hover:border-accent hover:shadow-paper">
              <div className="flex items-start justify-between gap-4">
                <IconTile icon={STEP_ICONS[i % STEP_ICONS.length]} />
                <Eyebrow>{step.number}</Eyebrow>
              </div>
              <h3 className="mt-7 font-serif text-2xl leading-snug text-foreground">
                {step.title}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-pretty text-muted-foreground">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
