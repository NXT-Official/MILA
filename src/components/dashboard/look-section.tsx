export function LookSection({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  // Without a title the label *is* the section heading, so it carries the h3.
  const Label = title ? "p" : "h3";
  return (
    <section className="rounded-card border border-border bg-card p-5 md:p-6">
      <Label className="atelier-section-label mb-2">{label}</Label>
      {title ? (
        <h3 className="font-serif text-xl leading-snug mb-3 text-balance">{title}</h3>
      ) : null}
      {children}
    </section>
  );
}
