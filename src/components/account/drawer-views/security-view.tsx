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
  /** False for accounts that only sign in through a provider such as Google. */
  hasPassword: boolean;
  /** Plain names of those providers, e.g. ["Google"]. */
  signInProviders: string[];
  currentPassword: string;
  onCurrentPasswordChange: (v: string) => void;
  newPassword: string;
  onNewPasswordChange: (v: string) => void;
  confirmPassword: string;
  onConfirmPasswordChange: (v: string) => void;
  newPasswordOk: boolean;
  passwordSubmitting: boolean;
  onChangePassword: (e: React.FormEvent) => void;
  /** hCaptcha widget — the password re-auth is captcha-protected server-side. */
  captchaField: React.ReactNode;
  captchaReady: boolean;
  deleteEmail: string;
  onDeleteEmailChange: (v: string) => void;
  deleteEmailMatches: boolean;
  deleting: boolean;
  onDeleteAccount: () => void;
}

function signInNote(providers: string[]): string {
  if (providers.length === 0) return "You sign in with a linked account";
  if (providers.length === 1) return `You sign in with ${providers[0]}`;
  return `You sign in with ${providers.slice(0, -1).join(", ")} and ${providers[providers.length - 1]}`;
}

export function SecurityView({
  authUserEmail,
  newEmail,
  onNewEmailChange,
  emailSubmitting,
  onChangeEmail,
  hasPassword,
  signInProviders,
  currentPassword,
  onCurrentPasswordChange,
  newPassword,
  onNewPasswordChange,
  confirmPassword,
  onConfirmPasswordChange,
  newPasswordOk,
  passwordSubmitting,
  onChangePassword,
  captchaField,
  captchaReady,
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
          aria-label="New email address"
          autoComplete="email"
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

      {hasPassword ? (
        <form onSubmit={onChangePassword} className="space-y-3 pt-6 border-t border-porcelain/30">
          <p className="atelier-label">Change password</p>
          <Input
            type="password"
            aria-label="Current password"
            autoComplete="current-password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => onCurrentPasswordChange(e.target.value)}
            className="h-10"
          />
          <Input
            type="password"
            aria-label="New password"
            autoComplete="new-password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => onNewPasswordChange(e.target.value)}
            className="h-10"
          />
          <Input
            type="password"
            aria-label="Confirm new password"
            autoComplete="new-password"
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
          {captchaField}
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={
              passwordSubmitting ||
              !currentPassword ||
              !newPasswordOk ||
              newPassword !== confirmPassword ||
              !captchaReady
            }
            className="w-full"
          >
            {passwordSubmitting ? "Updating…" : "Update Password"}
          </Button>
        </form>
      ) : (
        <div className="space-y-2 pt-6 border-t border-porcelain/30">
          <p className="atelier-label">Change password</p>
          <p className="text-sm text-ink">{signInNote(signInProviders)}</p>
          <p className="text-xs text-stone leading-relaxed">
            There is no password to change here. To keep your account safe, manage your sign-in with
            that provider.
          </p>
        </div>
      )}

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
