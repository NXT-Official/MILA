export function SeasonTag({ season }: { season: string }) {
  return (
    <span className="inline-flex items-center rounded-pill border border-line bg-accent-soft px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-foreground/70">
      {season}
    </span>
  );
}
