import { useState } from "react";
import { useForm } from "react-hook-form";
import type * as z from "zod";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { signInWithPassword } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordVisibilityButton } from "@/components/ui/password-visibility-button";
import { authFormOptions, describedBy, loginSchema } from "@/components/login/auth-validation";
import { FieldError } from "@/components/login/field-error";
import { useCaptcha } from "@/components/login/use-captcha";
import { errorMessage } from "@/lib/utils";

type LoginFormValues = z.infer<typeof loginSchema>;

interface LoginFormProps {
  email: string;
  onEmailChange: (email: string) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
}

export function LoginForm({
  email,
  onEmailChange,
  showPassword,
  onToggleShowPassword,
}: LoginFormProps) {
  const [busy, setBusy] = useState(false);
  const captcha = useCaptcha();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>(authFormOptions(loginSchema, { email, password: "" }));
  const emailField = register("email");

  const onSubmit = async (data: LoginFormValues) => {
    if (!captcha.token) {
      toast.error("Please complete the captcha challenge.");
      return;
    }
    setBusy(true);
    try {
      const { session } = await signInWithPassword({
        data: {
          email: data.email,
          password: data.password,
          captchaToken: captcha.token,
        },
      });
      if (session) await supabase.auth.setSession(session);
    } catch (err) {
      toast.error(errorMessage(err, "Authentication failed"));
    } finally {
      captcha.reset();
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="login-email" className="text-xs">
          Email Address
        </Label>
        <Input
          id="login-email"
          type="email"
          // src: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill-field-name · 2026-10-07
          // The email is this account's sign-in name, so it is the `username` that
          // `current-password` below is "the current password for".
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@studio.com"
          className="h-10"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={describedBy(errors.email && "login-email-error")}
          {...emailField}
          onChange={(e) => {
            emailField.onChange(e);
            onEmailChange(e.target.value);
          }}
        />
        <FieldError id="login-email-error" message={errors.email?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="login-password" className="text-xs">
          Security Password
        </Label>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Your password"
            className="h-10 pr-10"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={describedBy(errors.password && "login-password-error")}
            {...register("password")}
          />
          <PasswordVisibilityButton visible={showPassword} onToggle={onToggleShowPassword} />
        </div>
        <FieldError id="login-password-error" message={errors.password?.message} />
      </div>

      {captcha.field}

      <Button type="submit" disabled={busy || !captcha.token} className="w-full h-10 gap-2">
        {busy ? "Please wait…" : "Enter Mila Studio"}
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}
