import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoginForm } from "./login-form";
import { SignupForm } from "./signup-form";

async function handleGoogleOAuth() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
    if (error) toast.error("Google sign-in failed. Please try again.");
  } catch {
    toast.error("Google sign-in unavailable.");
  }
}

export function AuthCard() {
  const [activeTab, setActiveTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const toggleShowPassword = () => setShowPassword((v) => !v);

  return (
    <Card className="w-full max-w-sm border-border/60 shadow-sm">
      <CardHeader className="space-y-1.5 pb-4">
        <CardTitle className="font-serif text-xl">Get Started</CardTitle>
        <CardDescription className="text-xs">
          Log in or sign up below to unlock your studio color dossier.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <Button
          type="button"
          variant="outline"
          onClick={handleGoogleOAuth}
          className="w-full h-10 gap-2"
        >
          <img src="/google.svg" alt="google-icon" className="size-5" />
          Continue with Google
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/60" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase tracking-[0.3em]">
            <span className="bg-card px-3 text-muted-foreground">Or continue with email</span>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as "login" | "signup");
            setEmail("");
            setShowPassword(false);
          }}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2 h-9">
            <TabsTrigger value="login" className="text-xs">
              Log In
            </TabsTrigger>
            <TabsTrigger value="signup" className="text-xs">
              Sign Up
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="mt-4">
            <LoginForm
              email={email}
              onEmailChange={setEmail}
              showPassword={showPassword}
              onToggleShowPassword={toggleShowPassword}
            />
          </TabsContent>
          <TabsContent value="signup" className="mt-4">
            <SignupForm
              email={email}
              onEmailChange={setEmail}
              showPassword={showPassword}
              onToggleShowPassword={toggleShowPassword}
            />
          </TabsContent>
        </Tabs>
      </CardContent>

      <div className="px-6 pb-5 -mt-1">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 justify-center">
          <ShieldCheck className="size-3" />
          Your sign-in is encrypted and secure.
        </div>
      </div>
    </Card>
  );
}
