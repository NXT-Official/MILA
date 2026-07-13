import { Reveal } from "@/components/landing/reveal";
import { STEPS } from "@/constants/landing";

export function HowItWorksSection() {
  return (
    <Reveal className="mx-auto w-full max-w-6xl px-6 pb-24">
      <p className="atelier-kicker">How it works</p>
      <h2 className="mt-2 font-serif">Three steps to dressed</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="atelier-card p-6">
            <span className="font-serif text-3xl text-accent">{s.n}</span>
            <h3 className="mt-3 font-serif text-xl text-foreground">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>
    </Reveal>
  );
}
