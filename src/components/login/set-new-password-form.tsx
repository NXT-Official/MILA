import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowRight, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { updatePassword } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordVisibilityButton } from "@/components/ui/password-visibility-button";
import { passwordChecks } from "@/constants/password";
import { errorMessage } from "@/lib/utils";

const setNewPasswordSchema = z
  .object({
    password: z.string().min(8, { message: "Password must be at least 8 characters." }),
    confirmPassword: z.string().min(8, { message: "Please confirm your new password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type SetNewPasswordFormValues = z.infer<typeof setNewPasswordSchema>;

export function SetNewPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<SetNewPasswordFormValues>({
    resolver: zodResolver(setNewPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const password = watch("password") ?? "";
  const passedChecks = passwordChecks.filter((c) => c.test(password)).length;
  const passwordOk = passedChecks === passwordChecks.length;
  const strength =
    passedChecks <= 2
      ? { label: "Weak", bar: "bg-destructive", text: "text-destructive" }
      : passedChecks < passwordChecks.length
        ? { label: "Medium", bar: "bg-warning", text: "text-warning" }
        : { label: "Strong", bar: "bg-success", text: "text-success" };

  const onSubmit = async (data: SetNewPasswordFormValues) => {
    if (!passwordOk) {
      toast.error("Password does not meet the security requirements yet.");
      return;
    }
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        toast.error("Your reset link has expired. Please request a new one.");
        return;
      }
      await updatePassword({
        data: {
          password: data.password,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        },
      });
      toast.success("Password updated. Redirecting to your studio…");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(errorMessage(err, "Unable to update your password."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="new-password" className="text-xs">
          New Password
        </Label>
        <div className="relative">
          <Input
            id="new-password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            className="h-10 pr-10"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "new-password-error" : undefined}
            {...register("password")}
          />
          <PasswordVisibilityButton
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
        </div>
        {errors.password && (
          <p id="new-password-error" className="text-xs text-destructive">
            {errors.password.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-new-password" className="text-xs">
          Confirm New Password
        </Label>
        <div className="relative">
          <Input
            id="confirm-new-password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            className="h-10 pr-10"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={errors.confirmPassword ? "confirm-new-password-error" : undefined}
            {...register("confirmPassword")}
          />
          <PasswordVisibilityButton
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
        </div>
        {errors.confirmPassword && (
          <p id="confirm-new-password-error" className="text-xs text-destructive">
            {errors.confirmPassword.message}
          </p>
        )}
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

      <Button type="submit" disabled={busy || !passwordOk} className="w-full h-10 gap-2">
        {busy ? "Please wait…" : "Update Password"}
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}
