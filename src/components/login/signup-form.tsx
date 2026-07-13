import { useRef, useState } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowRight, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordVisibilityButton } from "@/components/ui/password-visibility-button";
import { passwordChecks } from "@/constants/password";

const signupSchema = z.object({
  username: z
    .string()
    .min(3, { message: "Username must be at least 3 characters." })
    .max(30, { message: "Username must be 30 characters or fewer." })
    .regex(/^[a-zA-Z0-9_-]+$/, { message: "Letters, numbers, underscores and dashes only." }),
  email: z.string().email({ message: "Please enter a valid studio email address." }),
  password: z.string().min(8, { message: "Password must be at least 8 characters." }),
});

type SignupFormValues = z.infer<typeof signupSchema>;

interface SignupFormProps {
  email: string;
  onEmailChange: (email: string) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
}

export function SignupForm({
  email,
  onEmailChange,
  showPassword,
  onToggleShowPassword,
}: SignupFormProps) {
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HCaptcha>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { username: "", email, password: "" },
  });
  const emailField = register("email");

  const password = watch("password") ?? "";
  const passedChecks = passwordChecks.filter((c) => c.test(password)).length;
  const passwordOk = passedChecks === passwordChecks.length;
  const strength =
    passedChecks <= 2
      ? { label: "Weak", bar: "bg-destructive", text: "text-destructive" }
      : passedChecks < passwordChecks.length
        ? { label: "Medium", bar: "bg-amber-500", text: "text-amber-600" }
        : { label: "Strong", bar: "bg-emerald-500", text: "text-emerald-600" };

  const onSubmit = async (data: SignupFormValues) => {
    if (!captchaToken) {
      toast.error("Please complete the captcha challenge.");
      return;
    }
    if (!passwordOk) {
      toast.error("Password does not meet the security requirements yet.");
      return;
    }
    setBusy(true);
    try {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: { username: data.username },
          captchaToken,
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      captchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="signup-username" className="text-xs">
          Studio Username
        </Label>
        <Input
          id="signup-username"
          placeholder="atelier_handle"
          className="h-10"
          {...register("username")}
        />
        {errors.username && <p className="text-xs text-destructive">{errors.username.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-email" className="text-xs">
          Email Address
        </Label>
        <Input
          id="signup-email"
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
        <Label htmlFor="signup-password" className="text-xs">
          Security Password
        </Label>
        <div className="relative">
          <Input
            id="signup-password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            className="h-10 pr-10"
            {...register("password")}
          />
          <PasswordVisibilityButton visible={showPassword} onToggle={onToggleShowPassword} />
        </div>
        {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
      </div>

      {password && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${strength.bar}`}
                style={{ width: `${(passedChecks / passwordChecks.length) * 100}%` }}
              />
            </div>
            <span className={`text-[10px] font-medium uppercase tracking-wider ${strength.text}`}>
              {strength.label}
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {passwordChecks.map((c) => {
              const ok = c.test(password);
              return (
                <li
                  key={c.label}
                  className={`flex items-center gap-1.5 text-[11px] ${
                    ok ? "text-emerald-600" : "text-muted-foreground"
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

      <div className="flex justify-center">
        <HCaptcha
          ref={captchaRef}
          sitekey={import.meta.env.VITE_HCAPTCHA_SITEKEY}
          onVerify={setCaptchaToken}
          onExpire={() => setCaptchaToken(null)}
        />
      </div>

      <Button
        type="submit"
        disabled={busy || !captchaToken || !passwordOk}
        className="w-full h-10 gap-2"
      >
        {busy ? "Please wait…" : "Create Atelier Account"}
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}
