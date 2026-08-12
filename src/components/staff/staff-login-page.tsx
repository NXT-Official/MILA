import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useLoginRedirect } from "@/hooks/use-login-redirect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/login/login-form";

/** One form per staff tree — each accepts only its own role. */
const COPY = {
  admin: {
    kicker: "Atelier Steward Suite",
    title: "Steward Sign In",
    description: "Stewards only. Moderators and members sign in elsewhere.",
  },
  moderator: {
    kicker: "Atelier Moderation Desk",
    title: "Moderator Sign In",
    description: "Moderators only. Stewards and members sign in elsewhere.",
  },
} as const;

export function StaffLoginPage({ tree }: { tree: "admin" | "moderator" }) {
  // Rejects a sign-in that doesn't belong to this tree — see useLoginRedirect.
  useLoginRedirect(tree);
  const copy = COPY[tree];
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="text-center">
        <div className="inline-flex items-center gap-2.5 font-serif text-2xl tracking-label-xwide">
          <img src="/favicon.svg" alt="" className="size-7" />
          MILA
        </div>
        <p className="atelier-kicker mt-3">{copy.kicker}</p>
      </div>

      <Card className="w-full max-w-sm border-border/60 shadow-sm">
        <CardHeader className="space-y-1.5 pb-4">
          <CardTitle className="font-serif text-xl">{copy.title}</CardTitle>
          <CardDescription className="text-xs">{copy.description}</CardDescription>
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
