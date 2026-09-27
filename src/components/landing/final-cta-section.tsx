import { Lock } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section";
import { CtaButton } from "@/components/landing/cta-button";
import type { FinalCtaContent } from "@/lib/landing-content";

export function FinalCtaSection({ content }: { content: FinalCtaContent }) {
  const reduce = useReducedMotion() ?? false;

  return (
    <Reveal
      id="start"
      className="relative isolate scroll-mt-16 overflow-hidden border-t border-border text-center"
    >
      <motion.img
        src="/landing/final-cta-bg.jpg"
        alt=""
        aria-hidden="true"
        width={1600}
        height={900}
        loading="lazy"
        className="absolute inset-0 -z-10 size-full object-cover"
        initial={reduce ? false : { scale: 1.06 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-canvas/90" />

      <div className="atelier-container py-20 sm:py-24">
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
      </div>
    </Reveal>
  );
}
