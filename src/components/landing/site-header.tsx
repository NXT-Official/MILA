import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";

export type NavSection = { id: string; label: string };

export function SiteHeader({ sections = [] }: { sections?: NavSection[] }) {
  const { session } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const destination = session ? "/dashboard" : "/login";
  const label = session ? "Dashboard" : "Sign in";

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-canvas/80 backdrop-blur-md">
      <div className="atelier-container flex h-16 items-center justify-between gap-6">
        <a
          href="#top"
          className="flex items-center gap-2.5 rounded-control font-serif text-xl font-bold tracking-label-xwide text-foreground"
        >
          <img src="/favicon.svg" alt="" width={24} height={24} className="size-6" />
          MILA
        </a>

        {sections.length > 0 && (
          <nav aria-label="Page sections" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="inline-flex h-9 items-center rounded-pill px-3.5 text-sm text-muted-foreground transition-colors duration-200 ease-editorial hover:bg-accent-soft/50 hover:text-ink"
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
          <Button
            asChild
            variant="outline"
            size="pill"
            className="text-label uppercase tracking-label"
          >
            <Link to={destination}>{label}</Link>
          </Button>
          {sections.length > 0 && (
            <IconButton
              label="Open menu"
              variant="outline"
              size="sm"
              className="lg:hidden"
              onClick={() => setNavOpen(true)}
            >
              <Menu />
            </IconButton>
          )}
        </div>
      </div>

      {sections.length > 0 && (
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-6 sm:max-w-xs">
            <SheetHeader>
              <SheetTitle className="font-serif text-xl">Explore MILA</SheetTitle>
            </SheetHeader>
            <nav aria-label="Page sections">
              <ul className="flex flex-col gap-1">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      onClick={() => setNavOpen(false)}
                      className="flex h-11 items-center rounded-control px-3 text-sm text-muted-foreground transition-colors duration-200 ease-editorial hover:bg-accent-soft/50 hover:text-ink"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <Button asChild variant="primary" size="md" className="mt-auto w-full">
              <Link to={destination} onClick={() => setNavOpen(false)}>
                {label}
              </Link>
            </Button>
          </SheetContent>
        </Sheet>
      )}
    </header>
  );
}
