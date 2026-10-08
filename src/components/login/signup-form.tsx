import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type * as z from "zod";
import { ArrowRight, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordVisibilityButton } from "@/components/ui/password-visibility-button";
import { authFormOptions, describedBy, signupSchema } from "@/components/login/auth-validation";
import { FieldError } from "@/components/login/field-error";
import { useCaptcha } from "@/components/login/use-captcha";
import { completeSignup, signupRequest } from "@/components/login/signup-flow";
import { passwordChecks } from "@/constants/password";
import { signUpWithPassword } from "@/lib/auth.functions";
import { trackEvent } from "@/lib/track-event";

type SignupFormValues = z.infer<typeof signupSchema>;

interface SignupFormProps {
  email: string;
  onEmailChange: (email: string) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
  /** Where the confirmation email should bring her back to (re-checked). */
  returnTo?: string;
}

export function SignupForm({
  email,
  onEmailChange,
  showPassword,
  onToggleShowPassword,
  returnTo,
}: SignupFormProps) {
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const captcha = useCaptcha();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<SignupFormValues>(
    authFormOptions(signupSchema, { username: "", email, password: "" }),
  );
  const emailField = register("email");

  useEffect(() => {
    // The message is about the last attempt; it stops being true once the member changes anything.
    // src: https://react-hook-form.com/docs/useform/watch (callback form, returns a subscription) · 7.80.0
    const subscription = watch(() => setFormError(null));
    return () => subscription.unsubscribe();
  }, [watch]);

  const password = watch("password") ?? "";
  const passedChecks = passwordChecks.filter((c) => c.test(password)).length;
  const passwordOk = passedChecks === passwordChecks.length;
  const strength =
    passedChecks <= 2
      ? { label: "Weak", bar: "bg-destructive", text: "text-destructive" }
      : passedChecks < passwordChecks.length
        ? { label: "Medium", bar: "bg-warning", text: "text-warning" }
        : { label: "Strong", bar: "bg-success", text: "text-success" };

  const onSubmit = async (data: SignupFormValues) => {
    if (!captcha.token) {
      toast.error("Please complete the captcha challenge.");
      return;
    }
    if (!passwordOk) {
      toast.error("Password does not meet the security requirements yet.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const outcome = await completeSignup({
        createAccount: () =>
          signUpWithPassword({
            data: signupRequest(data, captcha.token!, returnTo),
          }),
        startSession: (session) => supabase.auth.setSession(session),
        trackSignup: (session) => trackEvent(supabase, session.user.id, "signup_completed"),
      });
      if (outcome.status === "created") {
        toast.success(outcome.message);
      } else {
        // Shown inline so it stays put while the member reads it and fixes the form,
        // and as the toast this path always had. The toast is the one live channel
        // (sonner's toaster is an aria-live region), so the inline copy does not announce.
        setFormError(outcome.message);
        toast.error(outcome.message);
      }
    } finally {
      captcha.reset();
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="signup-username" className="text-xs">
          Studio Username
        </Label>
        <Input
          id="signup-username"
          // src: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill-field-name · 2026-10-07
          // `nickname` is "a typically short name used instead of the full name". This
          // handle is public, not the sign-in name (sign-in is by email), so it must not
          // be `username`: a password manager would save it as the login.
          autoComplete="nickname"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="atelier_handle"
          className="h-10"
          aria-invalid={errors.username ? true : undefined}
          aria-describedby={describedBy(errors.username && "signup-username-error")}
          {...register("username")}
        />
        <FieldError id="signup-username-error" message={errors.username?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-email" className="text-xs">
          Email Address
        </Label>
        <Input
          id="signup-email"
          type="email"
          // src: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill-field-name · 2026-10-07
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@studio.com"
          className="h-10"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={describedBy(errors.email && "signup-email-error")}
          {...emailField}
          onChange={(e) => {
            emailField.onChange(e);
            onEmailChange(e.target.value);
          }}
        />
        <FieldError id="signup-email-error" message={errors.email?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-password" className="text-xs">
          Security Password
        </Label>
        <div className="relative">
          <Input
            id="signup-password"
            type={showPassword ? "text" : "password"}
            // src: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill-field-name · 2026-10-07
            autoComplete="new-password"
            placeholder="Create a password"
            className="h-10 pr-10"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={describedBy(
              errors.password && "signup-password-error",
              password && "signup-password-requirements",
            )}
            {...register("password")}
          />
          <PasswordVisibilityButton visible={showPassword} onToggle={onToggleShowPassword} />
        </div>
        <FieldError id="signup-password-error" message={errors.password?.message} />
      </div>

      {password && (
        <div id="signup-password-requirements" className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${strength.bar}`}
                style={{ width: `${(passedChecks / passwordChecks.length) * 100}%` }}
              />
            </div>
            <span className={`text-micro font-medium uppercase tracking-wider ${strength.text}`}>
              {strength.label}
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {passwordChecks.map((c) => {
              const ok = c.test(password);
              return (
                <li
                  key={c.label}
                  className={`flex items-center gap-1.5 text-label ${
                    ok ? "text-success" : "text-muted-foreground"
                  }`}
                >
                  {ok ? <Check className="size-3" /> : <X className="size-3" />}
                  {c.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {captcha.field}

      <p className="text-micro leading-relaxed text-muted-foreground">
        By creating an account you agree to our{" "}
        <Link to="/privacy" className="atelier-focus-ring rounded underline hover:text-foreground">
          Privacy Policy
        </Link>{" "}
        and{" "}
        <Link to="/terms" className="atelier-focus-ring rounded underline hover:text-foreground">
          Terms
        </Link>
        .
      </p>

      <FieldError id="signup-form-error" message={formError ?? undefined} announce={false} />

      <Button
        type="submit"
        disabled={busy || !captcha.token || !passwordOk}
        className="w-full h-10 gap-2"
      >
        {busy ? "Please wait…" : "Create Atelier Account"}
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}
