import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowRight, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { requestPasswordReset } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCaptcha } from "@/components/login/use-captcha";
import { errorMessage } from "@/lib/utils";

const forgotPasswordSchema = z.object({
  email: z.string().email({ message: "Please enter a valid studio email address." }),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const captcha = useCaptcha();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotPasswordFormValues) => {
    if (!captcha.token) {
      toast.error("Please complete the captcha challenge.");
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset({
        data: { email: data.email, captchaToken: captcha.token },
      });
      toast.success("Check your inbox for a link to reset your password.");
      setSent(true);
    } catch (err) {
      toast.error(errorMessage(err, "Unable to send the reset link. Please try again."));
    } finally {
      captcha.reset();
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-3 py-2 text-center">
        <div className="mx-auto grid size-10 place-items-center rounded-full bg-accent-soft text-ink">
          <MailCheck aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </div>
        <p className="text-sm font-medium text-foreground">Check your inbox</p>
        <p className="text-xs text-muted-foreground">
          If an account exists for that email, we&apos;ve sent a link to reset your password.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="forgot-password-email" className="text-xs">
          Email Address
        </Label>
        <Input
          id="forgot-password-email"
          type="email"
          placeholder="name@studio.com"
          className="h-10"
          {...register("email")}
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>

      {captcha.field}

      <Button type="submit" disabled={busy || !captcha.token} className="w-full h-10 gap-2">
        {busy ? "Please wait…" : "Send Reset Link"}
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}
