import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { DetailedColorProfile as StudioDossier } from "@/constants/style-profile";
import { normalizeStoredProfile } from "@/lib/style-profile/studio-dossier";
import { PhotoTryOn } from "@/components/style-profile/photo-try-on";
import { DossierTopBar } from "@/components/style-profile/shared";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyState } from "@/components/ui/empty-state";

/** Studio: the try-it-on workspace. The dossier itself lives at /profile. */
export function StudioPage() {
  const { user } = useAuth();
  const [dossier, setDossier] = useState<StudioDossier | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("color_profile")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setDossier(normalizeStoredProfile(data?.color_profile));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="min-h-screen bg-background text-muted-foreground">
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-24">
        <DossierTopBar counterpart="profile" />
        <div className="mt-6">
          {loading ? (
            <LoadingState label="Loading your palette…" className="py-24" />
          ) : dossier ? (
            <PhotoTryOn dossier={dossier} />
          ) : (
            // Without a calibrated season there is no palette to try on, and the
            // demo dossier would be someone else's colouring.
            <EmptyState
              as="h1"
              title="Your palette isn't set yet"
              description="Run the colour diagnostic in your dossier first — Studio previews the season it produces."
              action={
                <Button asChild size="pill">
                  <Link to="/profile">Open your dossier</Link>
                </Button>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
