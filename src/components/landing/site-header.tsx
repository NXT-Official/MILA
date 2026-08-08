import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { staffGateQueryOptions } from "@/lib/queries/admin";
import { MODERATOR_HOME } from "@/lib/authorization";

export type NavSection = { id: string; label: string };

export function SiteHeader({ sections = [] }: { sections?: NavSection[] }) {
  const { session } = useAuth();
  const { data: gate } = useQuery({ ...staffGateQueryOptions(), enabled: !!session });
  const staffHome = gate?.is_admin ? "/admin/dashboard" : MODERATOR_HOME;
  const destination = session ? (gate?.can_access_staff_area ? staffHome : "/dashboard") : "/login";
  const label = session ? (gate?.can_access_staff_area ? "Staff" : "Dashboard") : "Sign in";

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-canvas/80 backdrop-blur-md">
      <div className="atelier-container flex h-16 items-center justify-between gap-6 sm:h-16">
        <a
          href="#top"
          className="flex items-center gap-2.5 rounded-control font-serif text-xl font-bold tracking-label-xwide text-foreground"
        >
          <img src="/favicon.svg" alt="" className="size-6" />
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
            size="sm"
            className="rounded-full px-4 text-label uppercase tracking-label sm:h-11 sm:px-5"
          >
            <Link to={destination}>{label}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
