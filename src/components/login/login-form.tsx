import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { signInWithPassword } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordVisibilityButton } from "@/components/ui/password-visibility-button";
import { useCaptcha } from "@/components/login/use-captcha";
import { errorMessage } from "@/lib/utils";

const loginSchema = z.object({
  email: z.string().email({ message: "Please enter a valid studio email address." }),
  password: z.string().min(8, { message: "Password must be at least 8 characters." }),
});

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
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email, password: "" },
  });
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="login-email" className="text-xs">
          Email Address
        </Label>
        <Input
          id="login-email"
          type="email"
          placeholder="name@studio.com"
          className="h-10"
          {...emailField}
          onChange={(e) => {
            emailField.onChange(e);
            onEmailChange(e.target.value);
          }}
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="login-password" className="text-xs">
          Security Password
        </Label>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            className="h-10 pr-10"
            {...register("password")}
          />
          <PasswordVisibilityButton visible={showPassword} onToggle={onToggleShowPassword} />
        </div>
        {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
      </div>

      {captcha.field}

      <Button type="submit" disabled={busy || !captcha.token} className="w-full h-10 gap-2">
        {busy ? "Please wait…" : "Enter Mila Studio"}
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}
