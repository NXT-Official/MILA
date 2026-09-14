import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/components/login/forgot-password-form";

export const Route = createFileRoute("/login/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
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
          <p className="atelier-kicker mt-3">Reset your password</p>
        </div>

        <Card className="w-full max-w-sm border-border/60 shadow-sm">
          <CardHeader className="space-y-1.5 pb-4">
            <CardTitle className="font-serif text-xl">Forgot password?</CardTitle>
            <CardDescription className="text-xs">
              Enter your studio email and we&apos;ll send you a link to reset it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ForgotPasswordForm />
          </CardContent>
        </Card>

        <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground">
          Back to login
        </Link>
      </div>
    </div>
  );
}
