import { motion, useReducedMotion } from "framer-motion";
import { Section, SectionHeading, Eyebrow } from "@/components/landing/section";
import { SeasonTag } from "@/components/landing/season-tag";
import type { DossierContent } from "@/lib/landing-content";

export function DossierSection({ content }: { content: DossierContent }) {
  const reduce = useReducedMotion() ?? false;

  return (
    <Section id="dossier" spacing="generous">
      <div className="grid items-start gap-16 lg:grid-cols-[5fr_6fr] lg:gap-24">
        <SectionHeading heading={content.heading} body={content.body} />

        {/* No card around it. A dossier is a list of findings, and rules between
            the findings say that better than a box drawn around the whole thing
            — which also stopped the reel dead behind an opaque panel. */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pb-5">
            <span className="text-lg tracking-[-0.01em] text-foreground">{content.cardTitle}</span>
            <SeasonTag season={content.season} />
          </div>

          <dl className="divide-y divide-line border-y border-line">
            {content.rows.map((row) => (
              <div
                key={row._key}
                className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-4 text-sm"
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="text-right font-medium text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-8">
            <div className="flex items-baseline justify-between gap-4">
              <Eyebrow>{content.completionLabel}</Eyebrow>
              <span className="text-label font-semibold tracking-label text-foreground">
                {content.completionPercent}%
              </span>
            </div>
            {/* ponytail: decorative bar — the percentage above already carries the value.
                The one place on the page where motion IS the meaning: a dossier that
                fills. scaleX, not width, so nothing lays out mid-animation. */}
            <div className="mt-3 h-0.5 w-full bg-line" aria-hidden="true">
              <motion.div
                className="h-full w-full origin-left bg-accent"
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: content.completionPercent / 100 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: reduce ? 0 : 0.9, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
