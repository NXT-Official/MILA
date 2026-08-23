import { Lock } from "lucide-react";
import { CtaButton } from "@/components/landing/cta-button";
import type { FinalCtaContent } from "@/lib/landing-content";

export function FinalCtaSection({ content }: { content: FinalCtaContent }) {
  return (
    // Same wash as every section above it — the close is a scale change, not a
    // tonal one. The drenched Ink ground it used to wear cut the reel dead.
    <section id="start" className="atelier-ground scroll-mt-24">
      <div className="atelier-container py-24 text-center sm:py-40 lg:py-48">
        {/* The one place the type is allowed to get large. Everything under it
            is deliberately small, so the heading has nothing to share with. */}
        <h2 className="mx-auto max-w-[18ch] text-[clamp(2.125rem,6.5vw,3.75rem)] leading-[1.05] tracking-[-0.03em] text-balance">
          {content.heading}
        </h2>
        <p className="mx-auto mt-6 max-w-[42ch] text-lg leading-[1.6] text-pretty text-muted-foreground">
          {content.body}
        </p>
        <div className="mt-12 flex justify-center">
          <CtaButton className="w-full sm:w-auto" />
        </div>
        <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3 shrink-0" aria-hidden="true" /> {content.privacyNote}
        </p>
      </div>
    </section>
  );
}
