import { Lock } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { CtaButton } from "@/components/landing/cta-button";
import { Card } from "@/components/ui/card";
import type { FinalCtaContent } from "@/lib/landing-content";

export function FinalCtaSection({ content }: { content: FinalCtaContent }) {
  return (
    <Reveal className="mx-auto w-full max-w-6xl px-6 pb-24">
      <Card className="p-10 text-center sm:p-16">
        <h2 className="font-serif">{content.heading}</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed">{content.body}</p>
        <div className="mt-8 flex justify-center">
          <CtaButton />
        </div>
        <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" /> {content.privacyNote}
        </p>
      </Card>
    </Reveal>
  );
}
