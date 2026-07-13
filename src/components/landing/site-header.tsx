import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { staffGateQueryOptions } from "@/lib/queries/admin";

export function SiteHeader() {
  const { session } = useAuth();
  const { data: gate } = useQuery({ ...staffGateQueryOptions(), enabled: !!session });
  const destination = session ? (gate?.can_access_staff_area ? "/admin" : "/dashboard") : "/login";
  const label = session ? (gate?.can_access_staff_area ? "Staff" : "Dashboard") : "Sign in";

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
      <span className="flex items-center gap-2.5 font-serif text-xl font-bold tracking-[0.35em] text-foreground">
        <img src="/favicon.svg" alt="" className="size-6" />
        MILA
      </span>
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <Button
          asChild
          variant="outline"
          size="sm"
          className="rounded-full text-[11px] uppercase tracking-[0.2em]"
        >
          <Link to={destination}>{label}</Link>
        </Button>
      </div>
    </header>
  );
}
