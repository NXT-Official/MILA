import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/constants/query-keys";
import { STEWARD_EMAIL } from "@/constants/app";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { session, loading, signOut, signingOut } = useAuth();
  const navigate = useNavigate();

  const userId = session?.user.id;
  const { data: suspended } = useQuery({
    queryKey: queryKeys.suspended(userId),
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("suspended")
        .eq("id", userId!)
        .maybeSingle();
      return !!data?.suspended;
    },
  });

  useEffect(() => {
    if (!loading && !session && !signingOut) navigate({ to: "/login" });
  }, [loading, session, signingOut, navigate]);

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="font-serif text-2xl tracking-[0.2em] text-muted-foreground animate-pulse">
          ATELIER
        </div>
      </div>
    );
  }

  if (suspended) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto size-8 text-stone" strokeWidth={1.2} />
          <h1 className="mt-6 font-serif text-2xl tracking-[0.2em] uppercase text-ink">
            Membership Suspended
          </h1>
          <p className="mt-3 text-sm text-stone leading-relaxed">
            Your atelier membership has been suspended by a steward. If you believe this is a
            mistake, contact us to request reinstatement.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <a
              href={`mailto:${STEWARD_EMAIL}?subject=Reinstatement%20request`}
              className="rounded-full bg-ink text-background text-[10px] uppercase tracking-[0.22em] px-5 py-2.5"
            >
              Contact Steward
            </a>
            <button
              onClick={() => signOut()}
              className="rounded-full border border-porcelain/60 text-[10px] uppercase tracking-[0.22em] text-stone hover:text-ink hover:border-porcelain px-5 py-2.5 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
