import type { FooterContent } from "@/lib/landing-content";

export function SiteFooter({ content }: { content: FooterContent }) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-6 py-8 text-center sm:flex-row sm:justify-between">
        <span className="font-serif text-sm tracking-label-xwide text-foreground">
          {content.wordmark}
        </span>
        <p className="text-xs text-muted-foreground">
          {content.tagline} · © {new Date().getFullYear()} Mila
        </p>
      </div>
    </footer>
  );
}
