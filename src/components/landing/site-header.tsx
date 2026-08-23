import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export type NavSection = { id: string; label: string };

export function SiteHeader({ sections = [] }: { sections?: NavSection[] }) {
  const { session } = useAuth();
  const destination = session ? "/dashboard" : "/login";
  const label = session ? "Dashboard" : "Sign in";

  // The bar is out of flow so the hero reel starts at y=0. Over the hero it is
  // pure air — the hero's own canvas fade carries the contrast — and it only
  // grows a ground once real content would otherwise scroll under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-200 ease-editorial",
        scrolled && "border-b border-border bg-canvas/80 backdrop-blur-md",
      )}
    >
      <div className="atelier-container relative flex h-16 items-center justify-between gap-6">
        <a
          href="#top"
          className="flex h-11 items-center gap-2.5 rounded-control font-serif text-xl font-bold tracking-label-xwide text-foreground"
        >
          <img src="/favicon.svg" alt="" className="size-6" />
          MILA
        </a>

        {sections.length > 0 && (
          <nav
            aria-label="Page sections"
            className="absolute left-1/2 hidden -translate-x-1/2 lg:block"
          >
            <ul className="flex items-center gap-8">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="inline-flex h-9 items-center text-xs font-medium uppercase tracking-label text-muted-foreground transition-opacity duration-200 ease-editorial hover:opacity-55"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <Button asChild size="pill" className="px-5 text-xs uppercase tracking-label">
            <Link to={destination}>{label}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
