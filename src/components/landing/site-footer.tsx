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
      {/* Tall and bottom-weighted on purpose: the space between the link block
          and the small print is where the reel actually gets to be seen. */}
      <div className="atelier-container flex min-h-[60svh] flex-col justify-between gap-16 pb-8 pt-24">
        <div className="flex flex-col gap-12 sm:flex-row sm:justify-between sm:gap-16">
          <div className="max-w-xs">
            <span className="flex items-center gap-2.5 font-serif text-lg font-bold tracking-label text-foreground">
              <img src="/favicon.svg" alt="" className="size-7" />
              {content.wordmark}
            </span>
            <p className="mt-4 text-sm leading-relaxed text-pretty text-muted-foreground">
              {content.tagline}
            </p>
          </div>

          {sections.length > 0 && (
            <nav aria-label="Footer">
              <ul className="flex flex-col gap-3">
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

        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} Mila. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
