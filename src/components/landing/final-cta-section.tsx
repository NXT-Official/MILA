import { Lock } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { CtaButton } from "@/components/landing/cta-button";
import type { FinalCtaContent } from "@/lib/landing-content";

export function FinalCtaSection({ content }: { content: FinalCtaContent }) {
  return (
    <Reveal id="start" className="scroll-mt-16 border-t border-border">
      <div className="atelier-container py-28 text-center sm:py-36 lg:py-44">
        <h2 className="mx-auto max-w-2xl text-[clamp(2.25rem,6vw,3rem)] leading-[1.05]">
          {content.heading}
        </h2>
        <p className="mx-auto mt-7 max-w-md text-lg leading-relaxed text-pretty text-muted-foreground">
          {content.body}
        </p>
        <div className="mt-10 flex justify-center">
          <CtaButton className="w-full sm:w-auto" />
        </div>
        <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" /> {content.privacyNote}
        </p>
      </div>
    </Reveal>
  );
}
