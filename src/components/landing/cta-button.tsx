import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

/**
 * Shared marketing CTA. The marketing pages are public and reachable while
 * signed in, so a member gets the studio instead of the login page. The
 * session resolves in an effect (see AuthProvider), so the first render — the
 * one that must match the server — is always the signed-out variant.
 */
export function CtaButton({ className }: { className?: string }) {
  const { user } = useAuth();
  return (
    <Button asChild size="pill-lg" className={cn(className)}>
      {user ? (
        <Link to="/dashboard">
          Open the studio
          <ArrowRight className="ml-2 size-4 text-accent" aria-hidden="true" />
        </Link>
      ) : (
        <Link to="/login">
          Get your first look
          <ArrowRight className="ml-2 size-4 text-accent" aria-hidden="true" />
        </Link>
      )}
    </Button>
  );
}
