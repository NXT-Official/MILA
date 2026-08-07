import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";
import { Card } from "@/components/ui/card";
import type { DossierContent } from "@/lib/landing-content";

export function DossierSection({ content }: { content: DossierContent }) {
  return (
    <Reveal className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 pb-24 lg:grid-cols-2">
      <div>
        <p className="atelier-kicker">{content.kicker}</p>
        <h2 className="mt-2 font-serif">{content.heading}</h2>
        <p className="mt-4 max-w-md text-base leading-relaxed text-pretty">{content.body}</p>
      </div>

      <Card className="p-7">
        <div className="flex items-center justify-between">
          <span className="font-serif text-lg text-foreground">{content.cardTitle}</span>
          <SeasonTag season={content.season} />
        </div>

        <div className="mt-5 space-y-3 text-sm">
          {content.rows.map((row) => (
            <div key={row._key} className="flex justify-between gap-4 border-b border-border pb-3">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="text-right text-foreground">{row.value}</span>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="flex justify-between text-micro uppercase tracking-label text-muted-foreground">
            <span>{content.completionLabel}</span>
            <span>{content.completionPercent}%</span>
          </div>

          <div className="mt-2 h-1.5 rounded-full bg-border">
            {/* Inline width — Tailwind cannot generate a class from a runtime value. */}
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${content.completionPercent}%` }}
            />
          </div>
        </div>
      </Card>
    </Reveal>
  );
}
