import { Lock } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { CtaButton } from "@/components/landing/cta-button";

export function FinalCtaSection() {
  return (
    <Reveal className="mx-auto w-full max-w-6xl px-6 pb-24">
      <div className="atelier-card p-10 text-center sm:p-16">
        <h2 className="font-serif">Style that knows you.</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed">
          Answer three quick questions and Mila will compose your first look — tuned to your colours,
          your shape, and today's weather.
        </p>
        <div className="mt-8 flex justify-center">
          <CtaButton />
        </div>
        <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" /> Your profile stays private. Always.
        </p>
      </div>
    </Reveal>
  );
}
