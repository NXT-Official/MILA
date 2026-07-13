import { Reveal } from "@/components/landing/reveal";

export function DupeHunterSection() {
  return (
    <Reveal className="mx-auto w-full max-w-6xl px-6 pb-24">
      <div className="atelier-card atelier-hero-card p-8 sm:p-12">
        <p className="atelier-kicker">Dupe Hunter</p>
        <h2 className="mt-2 font-serif">Mila found the dupe. You keep £340.</h2>
        <p className="mt-3 max-w-lg text-sm leading-relaxed">
          Photograph any fashion item and Mila finds an affordable alternative. Same look, a
          fraction of the price.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 max-w-2xl">
          <div className="rounded-panel border border-border bg-card/70 p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              The inspiration
            </p>
            <p className="mt-2 font-serif text-lg text-foreground">Wool-blend maxi coat</p>
            <p className="mt-1 text-sm text-muted-foreground line-through">£420</p>
          </div>
          <div className="rounded-panel border border-line bg-accent-soft p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-accent">Mila's match</p>
            <p className="mt-2 font-serif text-lg text-foreground">Same cut, same drape</p>
            <p className="mt-1 text-sm font-medium text-foreground">£80</p>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
