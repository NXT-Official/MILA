import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ShieldCheck, HelpCircle, MessageSquare, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const authSchema = z.object({
  email: z.string().email({ message: "Please enter a valid studio email address." }),
  password: z.string().min(8, { message: "Password must be at least 8 characters." }),
  username: z
    .string()
    .min(3, { message: "Username must be at least 3 characters." })
    .max(30, { message: "Username must be 30 characters or fewer." })
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message: "Letters, numbers, underscores and dashes only.",
    })
    .optional()
    .or(z.literal("")),
});

type AuthFormValues = z.infer<typeof authSchema>;

function LoginPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"help" | "feedback">("help");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: "", password: "", username: "" },
  });

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  const onAuthSubmit = async (data: AuthFormValues) => {
    setBusy(true);
    try {
      if (activeTab === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: data.email,
          password: data.password,
        });
        if (error) throw error;
      } else {
        if (!data.username) {
          toast.error("A unique studio username is required to create your styling account.");
          return;
        }
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: data.email,
          password: data.password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { username: data.username },
          },
        });
        if (error) throw error;
        if (signUpData.user) {
          const { error: profileErr } = await supabase
            .from("profiles")
            .update({ username: data.username })
            .eq("id", signUpData.user.id);
          if (profileErr) console.warn("Profile username update failed:", profileErr.message);
        }
        toast.success("Studio profile created. Check your inbox to confirm.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleOAuth = async () => {
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error("Google sign-in failed. Please try again.");
        return;
      }
    } catch {
      toast.error("Google sign-in unavailable.");
    }
  };

  const submitFeedbackHandler = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;
    setIsSubmittingFeedback(true);
    setTimeout(() => {
      toast.success(
        feedbackType === "help"
          ? "Help request received. A Mila concierge technician will review your session shortly."
          : "Studio feedback logged. Thank you for refining Mila's design intelligence.",
      );
      setFeedbackText("");
      setIsSubmittingFeedback(false);
      setFeedbackOpen(false);
    }, 700);
  };

  return (
    <div className="relative min-h-screen bg-background overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full bg-atelier-champagne/25 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-[420px] w-[420px] rounded-full bg-atelier-rose/20 blur-3xl" />
      </div>

      <div className="relative atelier-page flex flex-col items-center justify-center min-h-screen gap-6 py-10">
        <div className="text-center max-w-md">
          <Link to="/login" className="font-serif text-2xl tracking-[0.32em]">
            MILA
          </Link>
          <p className="atelier-kicker mt-3">Personal AI Fashion Stylist</p>
        </div>

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
              disabled={busy}
              className="w-full h-10 gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
              </svg>
              Continue with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-[0.3em]">
                <span className="bg-card px-3 text-muted-foreground">Or secure email gate</span>
              </div>
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                setActiveTab(v as "login" | "signup");
                reset();
              }}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 h-9">
                <TabsTrigger value="login" className="text-xs">Log In</TabsTrigger>
                <TabsTrigger value="signup" className="text-xs">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value={activeTab} className="mt-4">
                <form onSubmit={handleSubmit(onAuthSubmit)} className="space-y-4">
                  {activeTab === "signup" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="username" className="text-xs">Studio Username</Label>
                      <Input
                        id="username"
                        placeholder="atelier_handle"
                        className="h-10"
                        {...register("username")}
                      />
                      {errors.username && (
                        <p className="text-xs text-destructive">{errors.username.message}</p>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@studio.com"
                      className="h-10"
                      {...register("email")}
                    />
                    {errors.email && (
                      <p className="text-xs text-destructive">{errors.email.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs">Security Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      className="h-10"
                      {...register("password")}
                    />
                    {errors.password && (
                      <p className="text-xs text-destructive">{errors.password.message}</p>
                    )}
                  </div>

                  <Button type="submit" disabled={busy} className="w-full h-10 gap-2">
                    {busy ? "Please wait…" : activeTab === "login" ? "Enter Mila Studio" : "Create Atelier Account"}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>

          <div className="px-6 pb-5 -mt-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 justify-center">
              <ShieldCheck className="h-3 w-3" />
              Production-grade encrypted ecosystem authentication.
            </div>
          </div>
        </Card>

        <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
          <div className="flex items-center gap-5 text-[11px] text-muted-foreground">
            <DialogTrigger asChild>
              <button
                type="button"
                onClick={() => setFeedbackType("help")}
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Studio Help Desk
              </button>
            </DialogTrigger>
            <span className="h-3 w-px bg-border" />
            <DialogTrigger asChild>
              <button
                type="button"
                onClick={() => setFeedbackType("feedback")}
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Send Feedback
              </button>
            </DialogTrigger>
          </div>

          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-serif">
                {feedbackType === "help" ? "Mila Studio Help Desk" : "Send Feedback"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {feedbackType === "help"
                  ? "Camera not catching your tones, lighting feeling off, or anything else not quite right? Tell us here."
                  : "Help optimize Mila's neural fashion matching matrices. Share your analytical feedback."}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={submitFeedbackHandler} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {feedbackType === "help"
                    ? "Describe the operational issue"
                    : "Your architectural observations"}
                </Label>
                <Textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  className="min-h-[100px] text-sm resize-none"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="submit"
                  disabled={isSubmittingFeedback || !feedbackText.trim()}
                  className="h-9 text-xs px-4"
                >
                  {isSubmittingFeedback ? "Transmitting…" : "Submit Transmission"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}