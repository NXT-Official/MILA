import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { AtelierSplash } from "@/components/layout/atelier-splash";
import { SuspendedGate } from "@/components/layout/suspended-gate";

export const Route = createFileRoute("/_authenticated")({
  // Client-only guard — see /admin/_authed for why.
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { session, loading, signingOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session && !signingOut) navigate({ to: "/login" });
  }, [loading, session, signingOut, navigate]);

  if (loading || !session) {
    return <AtelierSplash />;
  }

  return (
    <SuspendedGate>
      <Outlet />
    </SuspendedGate>
  );
}
