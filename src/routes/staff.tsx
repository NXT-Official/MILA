import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useLoginRedirect } from "@/hooks/use-login-redirect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/login/login-form";

export const Route = createFileRoute("/staff")({
  component: StaffLoginPage,
});

function StaffLoginPage() {
  // Admins land on /admin/dashboard, moderators on /moderator/moderation;
  // a plain member is signed back out with an error.
  useLoginRedirect("staff");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="text-center">
        <div className="inline-flex items-center gap-2.5 font-serif text-2xl tracking-label-xwide">
          <img src="/favicon.svg" alt="" className="size-7" />
          MILA
        </div>
        <p className="atelier-kicker mt-3">Atelier Staff Suite</p>
      </div>

      <Card className="w-full max-w-sm border-border/60 shadow-sm">
        <CardHeader className="space-y-1.5 pb-4">
          <CardTitle className="font-serif text-xl">Staff Sign In</CardTitle>
          <CardDescription className="text-xs">
            Stewards and moderators only. Members sign in from the main site.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            email={email}
            onEmailChange={setEmail}
            showPassword={showPassword}
            onToggleShowPassword={() => setShowPassword((v) => !v)}
          />
        </CardContent>
        <div className="px-6 pb-5 -mt-1">
          <div className="flex items-center gap-1.5 text-micro text-muted-foreground/80 justify-center">
            <ShieldCheck className="size-3" />
            Your sign-in is encrypted and secure.
          </div>
        </div>
      </Card>
    </div>
  );
}
