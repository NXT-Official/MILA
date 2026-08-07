import { Reveal } from "@/components/landing/reveal";
import { Card } from "@/components/ui/card";
import type { DupeHunterContent } from "@/lib/landing-content";

export function DupeHunterSection({ content }: { content: DupeHunterContent }) {
  return (
    <Reveal className="mx-auto w-full max-w-6xl px-6 pb-24">
      <Card className="atelier-hero-card p-8 sm:p-12">
        <p className="atelier-kicker">{content.kicker}</p>
        <h2 className="mt-2 font-serif">{content.heading}</h2>
        <p className="mt-3 max-w-lg text-base leading-relaxed text-pretty">{content.body}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 max-w-2xl">
          <div className="rounded-panel border border-border bg-card/70 p-5">
            <p className="text-micro uppercase tracking-label text-muted-foreground">
              {content.inspiration.label}
            </p>
            <p className="mt-2 font-serif text-lg text-foreground">{content.inspiration.title}</p>
            <p className="mt-1 text-sm text-muted-foreground line-through">
              {content.inspiration.price}
            </p>
          </div>
          <div className="rounded-panel border border-border bg-accent-soft p-5">
            <p className="text-micro uppercase tracking-label text-ink">
              {content.milaMatch.label}
            </p>
            <p className="mt-2 font-serif text-lg text-foreground">{content.milaMatch.title}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{content.milaMatch.price}</p>
          </div>
        </div>
      </Card>
    </Reveal>
  );
}
