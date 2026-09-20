import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { passwordChecks } from "@/constants/password";

interface SecurityViewProps {
  authUserEmail: string | undefined;
  newEmail: string;
  onNewEmailChange: (v: string) => void;
  emailSubmitting: boolean;
  onChangeEmail: (e: React.FormEvent) => void;
  currentPassword: string;
  onCurrentPasswordChange: (v: string) => void;
  newPassword: string;
  onNewPasswordChange: (v: string) => void;
  confirmPassword: string;
  onConfirmPasswordChange: (v: string) => void;
  newPasswordOk: boolean;
  passwordSubmitting: boolean;
  onChangePassword: (e: React.FormEvent) => void;
  deleteEmail: string;
  onDeleteEmailChange: (v: string) => void;
  deleteEmailMatches: boolean;
  deleting: boolean;
  onDeleteAccount: () => void;
}

export function SecurityView({
  authUserEmail,
  newEmail,
  onNewEmailChange,
  emailSubmitting,
  onChangeEmail,
  currentPassword,
  onCurrentPasswordChange,
  newPassword,
  onNewPasswordChange,
  confirmPassword,
  onConfirmPasswordChange,
  newPasswordOk,
  passwordSubmitting,
  onChangePassword,
  deleteEmail,
  onDeleteEmailChange,
  deleteEmailMatches,
  deleting,
  onDeleteAccount,
}: SecurityViewProps) {
  return (
    <div className="space-y-8">
      <form onSubmit={onChangeEmail} className="space-y-3">
        <p className="atelier-label">Email address</p>
        <p className="text-xs text-stone">
          Current: <span className="text-ink">{authUserEmail}</span>
        </p>
        <Input
          type="email"
          placeholder="new@email.com"
          value={newEmail}
          onChange={(e) => onNewEmailChange(e.target.value)}
          className="h-10"
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={emailSubmitting || !newEmail.trim() || newEmail === authUserEmail}
          className="w-full"
        >
          {emailSubmitting ? "Sending confirmation…" : "Update Email"}
        </Button>
      </form>

      <form onSubmit={onChangePassword} className="space-y-3 pt-6 border-t border-porcelain/30">
        <p className="atelier-label">Change password</p>
        <Input
          type="password"
          placeholder="Current password"
          value={currentPassword}
          onChange={(e) => onCurrentPasswordChange(e.target.value)}
          className="h-10"
        />
        <Input
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => onNewPasswordChange(e.target.value)}
          className="h-10"
        />
        <Input
          type="password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => onConfirmPasswordChange(e.target.value)}
          className="h-10"
        />
        {newPassword && (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {passwordChecks.map((c) => {
              const ok = c.test(newPassword);
              return (
                <li
                  key={c.label}
                  className={`flex items-center gap-1.5 text-label ${
                    ok ? "text-success" : "text-stone"
                  }`}
                >
                  {ok ? <Check className="size-3" /> : <X className="size-3" />}
                  {c.label}
                </li>
              );
            })}
          </ul>
        )}
        {confirmPassword && newPassword !== confirmPassword && (
          <p className="text-label text-destructive">Passwords don't match.</p>
        )}
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={
            passwordSubmitting ||
            !currentPassword ||
            !newPasswordOk ||
            newPassword !== confirmPassword
          }
          className="w-full"
        >
          {passwordSubmitting ? "Updating…" : "Update Password"}
        </Button>
      </form>

      <div className="space-y-3 pt-6 border-t border-destructive/20">
        <p className="text-micro uppercase tracking-label-wide text-destructive">Delete account</p>
        <p className="text-xs text-stone leading-relaxed">
          This erases your profile, looks, posts, favorites and uploaded photos for good. Any active
          membership is canceled at once. This cannot be undone.
        </p>
        <label htmlFor="delete-confirm-email" className="block text-label text-stone">
          Type <span className="text-ink font-medium">{authUserEmail}</span> to confirm.
        </label>
        <Input
          id="delete-confirm-email"
          type="email"
          autoComplete="off"
          placeholder={authUserEmail ?? "your@email.com"}
          value={deleteEmail}
          onChange={(e) => onDeleteEmailChange(e.target.value)}
          className="h-10"
        />
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDeleteAccount}
          disabled={!deleteEmailMatches || deleting}
          className="w-full"
        >
          {deleting && <Loader2 className="size-3.5 animate-spin" />}
          {deleting ? "Deleting…" : "Delete My Account"}
        </Button>
      </div>
    </div>
  );
}
