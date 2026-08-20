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
    // Line-separated, not carded: three bordered boxes stacked inside a page
    // read as noise, and the rule alone is enough to part them.
    <section className="border-t border-border/70 pt-6 first:border-t-0 first:pt-0">
      <Label className="atelier-section-label mb-2">{label}</Label>
      {title ? (
        <h3 className="font-serif text-xl leading-snug mb-3 text-balance">{title}</h3>
      ) : null}
      {children}
    </section>
  );
}
