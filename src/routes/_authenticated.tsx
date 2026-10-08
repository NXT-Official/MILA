import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthConnection } from "@/hooks/use-auth-connection";
import { supabase } from "@/integrations/supabase/client";
import { requireSignedIn } from "@/lib/auth-guard";
import { loginRedirectSearch } from "@/lib/safe-redirect";
import { AtelierSplash } from "@/components/layout/atelier-splash";
import { AuthReconnecting } from "@/components/layout/auth-reconnecting";
import { SuspendedGate } from "@/components/layout/suspended-gate";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    // Signed out → /login?redirect=<this page>. A network failure while
    // refreshing is NOT a sign-out: the layout below reconnects instead.
    await requireSignedIn(supabase.auth, location);
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { session, loading, signingOut } = useAuth();
  const { status, retryNow } = useAuthConnection();
  const navigate = useNavigate();
  const href = useLocation({ select: (location) => location.href });
  // Send her to /login once, from the page she was on. While that navigation
  // is pending this layout stays mounted and `href` already reads
  // `/login?redirect=…`; re-running on it would replace the URL with a bare
  // /login and lose the return path.
  const sentToLogin = useRef(false);

  useEffect(() => {
    if (session) {
      sentToLogin.current = false;
      return;
    }
    if (loading || signingOut || sentToLogin.current) return;
    sentToLogin.current = true;
    navigate({ to: "/login", search: loginRedirectSearch(href), replace: true });
  }, [loading, session, signingOut, navigate, href]);

  if (status === "reconnecting") {
    return <AuthReconnecting onRetry={retryNow} signInSearch={loginRedirectSearch(href)} />;
  }

  if (loading || !session) {
    return <AtelierSplash />;
  }

  return (
    <SuspendedGate>
      <Outlet />
    </SuspendedGate>
  );
}
