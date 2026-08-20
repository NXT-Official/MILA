import { Lock } from "lucide-react";
import { CtaButton } from "@/components/landing/cta-button";
import type { FinalCtaContent } from "@/lib/landing-content";

export function FinalCtaSection({ content }: { content: FinalCtaContent }) {
  return (
    // The page's only tonal break. Five cream bands then the ground drops out
    // from under the closing statement — the brand's own Ink, no new hue.
    <section
      id="start"
      className="scroll-mt-16 border-t border-border bg-drench text-drench-foreground"
    >
      <div className="atelier-container py-28 text-center sm:py-36 lg:py-44">
        {/* Explicit colour: the base layer pins h1-h3 to --color-foreground,
            which would otherwise win over the inherited ground. */}
        <h2 className="mx-auto max-w-2xl text-[clamp(2.25rem,6vw,3rem)] leading-[1.05] text-drench-foreground">
          {content.heading}
        </h2>
        <p className="mx-auto mt-7 max-w-md text-lg leading-relaxed text-pretty text-drench-foreground/75">
          {content.body}
        </p>
        <div className="mt-10 flex justify-center">
          <CtaButton inverted className="w-full sm:w-auto" />
        </div>
        <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-drench-foreground/60">
          <Lock className="size-3" aria-hidden="true" /> {content.privacyNote}
        </p>
      </div>
    </section>
  );
}
