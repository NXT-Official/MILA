import { createFileRoute, Link } from "@tanstack/react-router";
import { useLoginRedirect } from "@/hooks/use-login-redirect";
import { validateLoginSearch } from "@/lib/safe-redirect";
import { AuthReconnecting } from "@/components/layout/auth-reconnecting";
import { AuthCard } from "@/components/login/auth-card";
import { SupportDialog } from "@/components/login/support-dialog";

export const Route = createFileRoute("/login/")({
  // `redirect` is where she was before being asked to sign in. Only a
  // same-origin path survives; anything else is dropped, never followed.
  validateSearch: validateLoginSearch,
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const signedInButUnread = useLoginRedirect(redirect);
  if (signedInButUnread.unavailable) {
    return <AuthReconnecting onRetry={signedInButUnread.retry} signInSearch={{ redirect }} />;
  }

  return (
    <div className="relative min-h-screen bg-background overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-105 w-105 rounded-full bg-atelier-champagne/25 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-105 w-105 rounded-full bg-atelier-rose/20 blur-3xl" />
      </div>

      <div className="relative atelier-page flex flex-col items-center justify-center min-h-screen gap-6 py-10">
        <div className="text-center max-w-md">
          <Link
            to="/login"
            className="inline-flex items-center gap-2.5 font-serif text-2xl tracking-label-xwide"
          >
            <img src="/favicon.svg" alt="" className="size-7" />
            MILA
          </Link>
          <p className="atelier-kicker mt-3">Personal AI Fashion Stylist</p>
        </div>

        <AuthCard returnTo={redirect} />
        <SupportDialog />
      </div>
    </div>
  );
}
