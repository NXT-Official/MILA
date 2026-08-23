import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { CtaButton } from "@/components/landing/cta-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export type NavSection = { id: string; label: string };

function Wordmark({ className }: { className?: string }) {
  return (
    <a
      href="#top"
      className={cn(
        "atelier-focus-ring flex h-16 items-center gap-2 rounded-control font-serif text-base font-bold tracking-label text-foreground",
        className,
      )}
    >
      <img src="/favicon.svg" alt="" className="size-8" />
    </a>
  );
}

export function SiteHeader({ sections = [] }: { sections?: NavSection[] }) {
  const { session } = useAuth();
  const destination = session ? "/dashboard" : "/login";
  const label = session ? "Dashboard" : "Sign in";
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    // A floating pill, out of flow so the reel starts at y=0. It carries its own
    // surface at every scroll position, which is what killed the old scroll
    // listener: nothing about the bar depends on where the page is any more.
    <header className="fixed inset-x-0 top-0 z-50 pt-3">
      <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 lg:px-10">
        {/* Unlike the hero, the pill carries its own opaque surface, so it can
            follow the theme: `bg-surface` and `shadow-nav` both flip under
            `.dark`, and a dark slab over the light reel still separates. Only
            type sitting *directly* on the footage has to stay pinned light. */}
        <div className="relative flex h-14 items-center justify-between gap-4 rounded-pill bg-surface pl-5 pr-1.5 shadow-nav">
          <Wordmark />

          {sections.length > 0 && (
            // Centred on the pill, not on what's left between the mark and the
            // buttons — those two sides are different widths, so `justify-between`
            // put the nav visibly off-centre.
            <nav
              aria-label="Page sections"
              className="absolute left-1/2 hidden -translate-x-1/2 lg:block"
            >
              <ul className="flex items-center gap-1">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="atelier-focus-ring inline-flex h-8 items-center rounded-pill px-3 text-xs text-muted-foreground transition-colors duration-200 ease-editorial hover:bg-accent-soft/60 hover:text-ink"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle size="sm" />

            <Button asChild size="pill">
              <Link to={destination}>{label}</Link>
            </Button>

            {sections.length > 0 && (
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  {/* Same glass pill as the theme toggle, so the bar is one border
                    treatment rather than three. */}
                  <Button
                    variant="glass"
                    size="icon"
                    aria-label="Open menu"
                    className="size-9 rounded-pill lg:hidden"
                  >
                    <Menu className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                </SheetTrigger>

                <SheetContent side="right" className="flex flex-col gap-8">
                  <SheetHeader>
                    <SheetTitle className="font-serif tracking-label-xwide">MILA</SheetTitle>
                    <SheetDescription>Jump to a section, or start your dossier.</SheetDescription>
                  </SheetHeader>

                  <nav aria-label="Page sections" className="flex-1">
                    <ul className="flex flex-col divide-y divide-line border-y border-line">
                      {sections.map((section) => (
                        <li key={section.id}>
                          <a
                            href={`#${section.id}`}
                            onClick={() => setMenuOpen(false)}
                            className="atelier-focus-ring flex min-h-12 items-center rounded-control text-base text-ink transition-colors duration-200 ease-editorial hover:text-accent-ink"
                          >
                            {section.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </nav>

                  <CtaButton className="w-full" onNavigate={() => setMenuOpen(false)} />
                </SheetContent>
              </Sheet>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
