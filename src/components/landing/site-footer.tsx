import type { NavSection } from "@/components/landing/site-header";
import type { FooterContent } from "@/lib/landing-content";

export function SiteFooter({
  content,
  sections = [],
}: {
  content: FooterContent;
  sections?: NavSection[];
}) {
  return (
    // Same ground as every section above it. It used to sit on raw reel, which
    // ended the page on a hard cut from washed to sharp video.
    <footer className="atelier-ground">
      <div className="atelier-container pb-10 pt-24">
        <div className="flex flex-col gap-12 sm:flex-row sm:justify-between sm:gap-20">
          <div className="max-w-[32ch]">
            <span className="flex items-center gap-2.5 text-base font-bold tracking-label text-foreground">
              <img src="/favicon.svg" alt="" className="size-6" />
              {content.wordmark}
            </span>
            <p className="mt-4 text-sm leading-[1.7] text-pretty text-muted-foreground">
              {content.tagline}
            </p>
          </div>

          {sections.length > 0 && (
            <nav aria-label="Footer">
              <ul className="flex flex-wrap gap-x-8 gap-y-3 sm:flex-col sm:gap-y-3">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="atelier-focus-ring rounded-control text-sm text-muted-foreground transition-colors duration-200 ease-editorial hover:text-ink"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>

        {/* One rule closes the page, the same hairline that separates every peer
            item above it. */}
        <p className="mt-20 border-t border-line pt-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Mila. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
