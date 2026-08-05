import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/constants/query-keys";
import { STEWARD_EMAIL } from "@/constants/app";

/** Blocks a suspended account from every authenticated tree, members and staff alike. */
export function SuspendedGate({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth();
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

  if (!suspended) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <ShieldAlert className="mx-auto size-8 text-stone" strokeWidth={1.2} />
        <h1 className="mt-6 font-serif text-2xl tracking-label uppercase text-ink">
          Membership Suspended
        </h1>
        <p className="mt-3 text-sm text-stone leading-relaxed">
          Your atelier membership has been suspended by a steward. If you believe this is a mistake,
          contact us to request reinstatement.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <a
            href={`mailto:${STEWARD_EMAIL}?subject=Reinstatement%20request`}
            className="rounded-full bg-ink text-background text-micro uppercase tracking-label-wide px-5 py-2.5"
          >
            Contact Steward
          </a>
          <button
            onClick={() => signOut()}
            className="rounded-full border border-porcelain/60 atelier-label hover:text-ink hover:border-porcelain px-5 py-2.5 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
