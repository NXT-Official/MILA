export function LookSection({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-card p-5 md:p-6 shadow-paper">
      <p className="atelier-kicker mb-2">{kicker}</p>
      {title ? <h3 className="font-serif text-xl md:text-2xl leading-snug mb-3">{title}</h3> : null}
      {children}
    </section>
  );
}
