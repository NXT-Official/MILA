import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState } from "@/lib/queries/auth";
import { AuthCard } from "@/components/login/auth-card";
import { SupportDialog } from "@/components/login/support-dialog";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { session, loading } = useAuth();
  const viewer = useAuthenticatedViewerState(session?.user.id);
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !session || viewer.isLoading) return;
    navigate({ to: viewer.destination });
  }, [loading, session, viewer.isLoading, viewer.destination, navigate]);

  return (
    // Plain canvas. The two blurred champagne/rose blobs that used to sit here
    // were the only thing on the page competing with the card.
    <div className="min-h-screen bg-canvas">
      <div className="atelier-page flex min-h-screen flex-col items-center justify-center gap-6 py-10">
        <div className="text-center max-w-md">
          <Link
            to="/login"
            className="inline-flex items-center gap-2.5 font-serif text-2xl tracking-label-xwide"
          >
            <img src="/favicon.svg" alt="" className="size-7" />
            MILA
          </Link>
          <p className="mt-3 text-label font-semibold uppercase tracking-label text-muted-foreground">
            Personal AI Fashion Stylist
          </p>
        </div>

        <AuthCard />
        <SupportDialog />
      </div>
    </div>
  );
}
