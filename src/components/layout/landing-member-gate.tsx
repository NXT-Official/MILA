import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthConnection } from "@/hooks/use-auth-connection";
import { clearMemberArriving } from "@/lib/landing-member-guard";
import { AtelierSplash } from "@/components/layout/atelier-splash";

/**
 * Wraps the public landing. A signed-in member only ever sees the splash here
 * while the route sends her on; the landing is never painted again for her
 * once her session is known (it used to come back for the length of the
 * navigation to her dashboard).
 *
 * For the first paint, before React runs, `MEMBER_ARRIVING_SCRIPT` and
 * `MEMBER_ARRIVING_STYLE` (src/lib/landing-member-guard.ts, injected by the `/`
 * route's head) hide `[data-landing-root]` and show `[data-member-splash]` when
 * this browser holds a session.
 */
export function LandingMemberGate({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { status } = useAuthConnection();

  useEffect(() => {
    // Not signed in after all, or the auth server is unreachable: the landing
    // is the right page to show, so lift the pre-paint mark.
    if (status === "signed-out" || status === "reconnecting") clearMemberArriving();
  }, [status]);

  if (session) return <AtelierSplash />;

  return (
    <>
      <div data-member-splash="" className="fixed inset-0 z-50">
        <AtelierSplash />
      </div>
      <div data-landing-root="">{children}</div>
    </>
  );
}
