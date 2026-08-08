import type { FooterContent } from "@/lib/landing-content";

export function SiteFooter({ content }: { content: FooterContent }) {
  return (
    <footer className="border-t border-border">
      <div className="atelier-container flex flex-col items-center gap-3 py-10 text-center sm:flex-row sm:justify-between sm:text-left">
        <span className="flex items-center gap-2.5 font-serif text-sm tracking-label-xwide text-foreground">
          <img src="/favicon.svg" alt="" className="size-5" />
          {content.wordmark}
        </span>
        <p className="text-xs text-muted-foreground">
          {content.tagline} · © {new Date().getFullYear()} Mila
        </p>
      </div>
    </footer>
  );
}
