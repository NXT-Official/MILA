import { motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, CircleGauge, Fingerprint, ScanSearch } from "lucide-react";
import { Section, SectionHeading, Eyebrow } from "@/components/landing/section";
import type { DossierContent, DupeCard, DupeHunterContent } from "@/lib/landing-content";

const TILE =
  "rounded-overlay bg-ink/[0.05] p-6 ring-1 ring-line transition-[transform,background-color,box-shadow] duration-500 ease-editorial hover:-translate-y-1.5 hover:bg-ink/[0.08] hover:shadow-paper active:translate-y-0 active:scale-[0.99] active:duration-150 sm:p-7";

function DupeTile({ card, match = false }: { card: DupeCard; match?: boolean }) {
  const Icon = match ? BadgeCheck : ScanSearch;

  return (
    <article className={`${TILE} relative flex min-h-72 flex-col overflow-hidden`}>
      <div className="flex items-start justify-between gap-4">
        <Eyebrow className={match ? "text-accent-ink" : undefined}>{card.label}</Eyebrow>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-accent-ink ring-1 ring-line">
          <Icon className="size-4.5" strokeWidth={2} aria-hidden="true" />
        </span>
      </div>
      <div className="mt-auto pt-16">
        <h3 className="text-xl leading-snug tracking-[-0.015em] text-balance text-foreground">
          {card.title}
        </h3>
        <p
          className={`mt-4 text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums ${
            match ? "text-foreground" : "text-muted-foreground line-through decoration-1"
          }`}
        >
          {card.price}
        </p>
      </div>
    </article>
  );
}

export function DossierSection({
  content,
  dupeContent,
}: {
  content: DossierContent;
  dupeContent: DupeHunterContent;
}) {
  const reduce = useReducedMotion() ?? false;

  return (
    <Section id="dossier" spacing="generous">
      <SectionHeading align="center" heading={content.heading} body={content.body} />

      <div className="mt-14 grid gap-5 sm:mt-20 sm:grid-cols-2 md:grid-cols-3">
        <article className={`${TILE} relative min-h-64 overflow-hidden sm:col-span-2`}>
          <Fingerprint
            aria-hidden="true"
            className="absolute -bottom-12 -right-8 size-56 text-ink opacity-[0.06]"
            strokeWidth={0.8}
          />
          <div className="relative flex h-full flex-col justify-between gap-16">
            <div className="flex items-start justify-between gap-4">
              <Eyebrow>Personal profile</Eyebrow>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-accent-ink ring-1 ring-line">
                <Fingerprint className="size-4.5" aria-hidden="true" />
              </span>
            </div>
            <div>
              <h3 className="max-w-[18ch] text-2xl leading-tight tracking-[-0.02em] text-foreground sm:text-3xl">
                {content.cardTitle}
              </h3>
            </div>
          </div>
        </article>

        <article
          className={`${TILE} flex min-h-64 flex-col justify-between sm:col-span-2 md:col-span-1`}
        >
          <div className="flex items-start justify-between gap-4">
            <Eyebrow>{content.completionLabel}</Eyebrow>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-accent-ink ring-1 ring-line">
              <CircleGauge className="size-4.5" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-12">
            <p className="text-6xl font-semibold leading-none tracking-[-0.06em] text-foreground sm:text-7xl">
              {content.completionPercent}
              <span className="ml-1 text-2xl text-muted-foreground">%</span>
            </p>
            <div
              className="mt-6 h-1.5 overflow-hidden rounded-full bg-ink/10"
              role="progressbar"
              aria-label={content.completionLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={content.completionPercent}
            >
              <motion.div
                className="h-full w-full origin-left rounded-full bg-accent"
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: content.completionPercent / 100 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: reduce ? 0 : 0.9, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        </article>

        <dl className="grid gap-5 sm:col-span-2 sm:grid-cols-2 md:col-span-3 md:grid-cols-3">
          {content.rows.map((row, index) => (
            <div key={row._key} className={`${TILE} min-h-40`}>
              <span className="text-label font-semibold tabular-nums tracking-label text-accent-ink">
                {String(index + 1).padStart(2, "0")}
              </span>
              <dt className="mt-7 text-sm text-muted-foreground">{row.label}</dt>
              <dd className="mt-2 text-lg font-medium leading-snug tracking-[-0.01em] text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        <article id="dupe-hunter" className={`${TILE} scroll-mt-24 sm:col-span-2 md:col-span-1`}>
          <Eyebrow>Dupe hunter</Eyebrow>
          <h3 className="mt-8 text-2xl leading-tight tracking-[-0.02em] text-foreground sm:text-3xl">
            {dupeContent.heading}
          </h3>
          <p className="mt-5 text-base leading-[1.7] text-pretty text-muted-foreground">
            {dupeContent.body}
          </p>
        </article>

        <div>
          <DupeTile card={dupeContent.inspiration} />
        </div>
        <div>
          <DupeTile card={dupeContent.milaMatch} match />
        </div>
      </div>
    </Section>
  );
}
