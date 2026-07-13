export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-6 py-8 text-center sm:flex-row sm:justify-between">
        <span className="font-serif text-sm tracking-[0.3em] text-foreground">MILA</span>
        <p className="text-xs text-muted-foreground">
          Your AI stylist. Every morning. · © {new Date().getFullYear()} Mila
        </p>
      </div>
    </footer>
  );
}
