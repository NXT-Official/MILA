export function SeasonTag({ season }: { season: string }) {
  return (
    <span className="inline-flex items-center rounded-pill border border-border bg-accent-soft px-2.5 py-0.5 text-micro uppercase tracking-label text-foreground/70">
      {season}
    </span>
  );
}
