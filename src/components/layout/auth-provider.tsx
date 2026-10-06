import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AuthContext } from "@/hooks/use-auth";
import { identifyPhUser, resetPh } from "@/lib/posthog-client";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const previousUserId = useRef<string | null>(null);

  // PostHog person linking: identify the member once their session is known,
  // and clear the identity on sign-out so the next visitor starts fresh.
  useEffect(() => {
    const userId = session?.user?.id ?? null;
    if (userId && userId !== previousUserId.current) {
      identifyPhUser(userId);
    } else if (!userId && previousUserId.current) {
      resetPh();
    }
    previousUserId.current = userId;
  }, [session]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signingOut,
        signOut: async () => {
          setSigningOut(true);
          try {
            await supabase.auth.signOut();
            resetPh();
            window.location.href = "/";
          } catch (e) {
            setSigningOut(false);
            throw e;
          }
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
