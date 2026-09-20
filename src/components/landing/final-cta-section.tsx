import { Lock } from "lucide-react";
import { Section, SectionHeading } from "@/components/landing/section";
import { CtaButton } from "@/components/landing/cta-button";
import type { FinalCtaContent } from "@/lib/landing-content";

export function FinalCtaSection({ content }: { content: FinalCtaContent }) {
  return (
    <Section id="start" className="relative isolate text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -bottom-40 -z-10 mx-auto h-96 max-w-xl rounded-full bg-accent/15 blur-[130px]"
      />
      <SectionHeading
        align="center"
        heading={content.heading}
        body={content.body}
        className="mx-auto max-w-2xl"
      />
      <div className="mt-10 flex justify-center">
        <CtaButton className="w-full sm:w-auto" />
      </div>
      <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" aria-hidden="true" /> {content.privacyNote}
      </p>
    </Section>
  );
}
