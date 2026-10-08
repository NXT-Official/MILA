import { useState } from "react";
import { useForm } from "react-hook-form";
import type * as z from "zod";
import { ArrowRight, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { updatePassword } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordVisibilityButton } from "@/components/ui/password-visibility-button";
import {
  authFormOptions,
  describedBy,
  setNewPasswordSchema,
} from "@/components/login/auth-validation";
import { FieldError } from "@/components/login/field-error";
import { passwordChecks } from "@/constants/password";
import { errorMessage } from "@/lib/utils";

type SetNewPasswordFormValues = z.infer<typeof setNewPasswordSchema>;

export function SetNewPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors, touchedFields },
    watch,
  } = useForm<SetNewPasswordFormValues>(
    authFormOptions(setNewPasswordSchema, { password: "", confirmPassword: "" }),
  );
  const passwordField = register("password");

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
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="new-password" className="text-xs">
          New Password
        </Label>
        <div className="relative">
          <Input
            id="new-password"
            type={showPassword ? "text" : "password"}
            // src: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill-field-name · 2026-10-07
            autoComplete="new-password"
            placeholder="Create a new password"
            className="h-10 pr-10"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={describedBy(
              errors.password && "new-password-error",
              password && "new-password-requirements",
            )}
            {...passwordField}
            onChange={(e) => {
              void passwordField.onChange(e);
              // A confirmation the member already left must not keep a stale verdict.
              if (touchedFields.confirmPassword) void trigger("confirmPassword");
            }}
          />
          <PasswordVisibilityButton
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
        </div>
        <FieldError id="new-password-error" message={errors.password?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-new-password" className="text-xs">
          Confirm New Password
        </Label>
        <div className="relative">
          <Input
            id="confirm-new-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Repeat the new password"
            className="h-10 pr-10"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={describedBy(errors.confirmPassword && "confirm-new-password-error")}
            {...register("confirmPassword")}
          />
          <PasswordVisibilityButton
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
        </div>
        <FieldError id="confirm-new-password-error" message={errors.confirmPassword?.message} />
      </div>

      {password && (
        <div id="new-password-requirements" className="space-y-2">
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
