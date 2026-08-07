import { Reveal } from "@/components/landing/reveal";
import { Card } from "@/components/ui/card";
import type { HowItWorksContent } from "@/lib/landing-content";

export function HowItWorksSection({ content }: { content: HowItWorksContent }) {
  return (
    <Reveal className="mx-auto w-full max-w-6xl px-6 pb-24">
      <p className="atelier-kicker">{content.kicker}</p>
      <h2 className="mt-2 font-serif">{content.heading}</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {content.steps.map((s) => (
          <Card key={s._key} className="p-6">
            <span className="font-serif text-3xl text-muted-foreground">{s.number}</span>
            <h3 className="mt-3 font-serif text-xl text-foreground">{s.title}</h3>
            <p className="mt-2 text-base leading-relaxed text-pretty">{s.body}</p>
          </Card>
        ))}
      </div>
    </Reveal>
  );
}
