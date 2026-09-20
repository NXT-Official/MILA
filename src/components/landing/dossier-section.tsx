import { FileText } from "lucide-react";
import { Section, SectionHeading, Eyebrow, IconTile } from "@/components/landing/section";
import { SeasonTag } from "@/components/landing/season-tag";
import type { DossierContent } from "@/lib/landing-content";

export function DossierSection({ content }: { content: DossierContent }) {
  return (
    <Section id="dossier">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <SectionHeading kicker={content.kicker} heading={content.heading} body={content.body} />

        <div className="overflow-hidden rounded-card border border-border bg-card shadow-paper">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-7 py-6">
            <span className="flex items-center gap-3.5">
              <IconTile icon={FileText} size="sm" />
              <span className="font-serif text-lg text-foreground">{content.cardTitle}</span>
            </span>
            <SeasonTag season={content.season} />
          </div>

          <dl className="divide-y divide-border">
            {content.rows.map((row) => (
              <div
                key={row._key}
                className="flex flex-wrap justify-between gap-x-6 gap-y-1 px-7 py-4 text-sm"
              >
                <dt className="min-w-0 text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 text-right text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className="border-t border-border px-7 py-6">
            <div className="flex items-center justify-between">
              <Eyebrow>{content.completionLabel}</Eyebrow>
              <span className="text-label font-semibold text-foreground">
                {content.completionPercent}%
              </span>
            </div>
            {/* ponytail: decorative bar — the percentage above already carries the value. */}
            <div className="mt-3 h-px overflow-hidden bg-border" aria-hidden="true">
              {/* Inline width — Tailwind cannot generate a class from a runtime value. */}
              <div
                className="h-full bg-accent"
                style={{ width: `${content.completionPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
