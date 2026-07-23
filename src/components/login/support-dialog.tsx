import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { HelpCircle, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitSupportMessage } from "@/lib/support.functions";

export function SupportDialog() {
  const [feedbackType, setFeedbackType] = useState<"help" | "feedback">("help");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HCaptcha>(null);
  const submitSupport = useServerFn(submitSupportMessage);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    if (!captchaToken) {
      toast.error("Please complete the captcha challenge.");
      return;
    }
    setSubmitting(true);
    try {
      await submitSupport({ data: { kind: feedbackType, message: message.trim(), captchaToken } });
      toast.success(
        feedbackType === "help"
          ? "Help request received. Someone from the Mila team will look into it shortly."
          : "Feedback received. Thanks for helping us make Mila better.",
      );
      setMessage("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send that. Please try again.");
    } finally {
      captchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-5 text-[11px] text-muted-foreground">
        <DialogTrigger asChild>
          <button
            type="button"
            onClick={() => setFeedbackType("help")}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <HelpCircle className="size-3.5" />
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
            <MessageSquare className="size-3.5" />
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
              : "Got thoughts on Mila's styling suggestions? Let us know what's working and what isn't."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              {feedbackType === "help"
                ? "What went wrong?"
                : "Your feedback"}
            </Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-25 text-sm resize-none"
              required
            />
          </div>
          <div className="flex justify-center">
            <HCaptcha
              ref={captchaRef}
              sitekey={import.meta.env.VITE_HCAPTCHA_SITEKEY!}
              onVerify={setCaptchaToken}
              onExpire={() => setCaptchaToken(null)}
              onError={() => setCaptchaToken(null)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="submit"
              disabled={submitting || !message.trim() || !captchaToken}
              className="h-9 text-xs px-4"
            >
              {submitting ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
