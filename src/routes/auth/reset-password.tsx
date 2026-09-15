import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SetNewPasswordForm } from "@/components/login/set-new-password-form";

export const Route = createFileRoute("/auth/reset-password")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { session, loading } = useAuth();

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
          <p className="atelier-kicker mt-3">Set a new password</p>
        </div>

        <Card className="w-full max-w-sm border-border/60 shadow-sm">
          <CardHeader className="space-y-1.5 pb-4">
            <CardTitle className="font-serif text-xl">Choose a new password</CardTitle>
            <CardDescription className="text-xs">
              This takes effect immediately across the studio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-xs text-muted-foreground text-center py-2">
                Verifying your reset link…
              </p>
            ) : session ? (
              <SetNewPasswordForm />
            ) : (
              <div className="space-y-3 py-2 text-center">
                <p className="text-sm text-foreground">This reset link has expired.</p>
                <Link
                  to="/login/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Request a new link
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
