import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Link } from "@tanstack/react-router";
import { Archive, AlertCircle, ArrowRight, Check, Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { HUBS } from "@/constants/climate";
import { passwordChecks } from "@/constants/password";
import { fetchDefaultHubId, localDefaultHubId, saveDefaultHubId } from "@/lib/default-hub";
import { CreditsUsageMeter } from "@/components/account/credits-usage-meter";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { DEFAULT_AI_CREDITS } from "@/lib/credits";
import { queryKeys } from "@/constants/query-keys";
import { mySubscriptionQueryOptions } from "@/lib/queries/subscriptions";
import { cancelMySubscription, resumeMySubscription } from "@/lib/subscriptions.functions";
import { deleteMyAccount } from "@/lib/account.functions";
import { CancelMembershipDialog } from "@/components/account/cancel-membership-dialog";
import { errorMessage } from "@/lib/utils";

interface StudioMembershipDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  credits: number | null;
  user: {
    fullName: string;
    username: string;
    season: string | null;
    faceShape: string | null;
    hairType: string | null;
  };
}

export function StudioMembershipDrawer({
  isOpen,
  onClose,
  credits,
  user,
}: StudioMembershipDrawerProps) {
  const [view, setView] = useState<
    "membership" | "preferences" | "location" | "privacy" | "security"
  >("membership");
  const { user: authUser, signOut, signingOut } = useAuth();
  const queryClient = useQueryClient();
  const { data: subscription } = useQuery({
    ...mySubscriptionQueryOptions(authUser?.id),
    enabled: !!authUser,
  });
  const cancelSubscription = useServerFn(cancelMySubscription);
  const resumeSubscription = useServerFn(resumeMySubscription);
  const deleteAccount = useServerFn(deleteMyAccount);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const deleteEmailMatches =
    !!authUser?.email && deleteEmail.trim().toLowerCase() === authUser.email.toLowerCase();

  async function handleDeleteAccount() {
    if (!deleteEmailMatches) return;
    setDeleting(true);
    try {
      const result = await deleteAccount({ data: { email: deleteEmail.trim() } });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Your account and all of its data have been deleted.");
      await signOut();
    } catch (err) {
      toast.error(errorMessage(err, "We couldn't delete your account."));
    } finally {
      setDeleting(false);
    }
  }
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [resuming, setResuming] = useState(false);

  async function handleResume() {
    setResuming(true);
    try {
      const result = await resumeSubscription();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Your membership renews on ${new Date(result.renewsAt).toLocaleDateString()}.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.mySubscription(authUser?.id) });
    } finally {
      setResuming(false);
    }
  }

  async function handleConfirmCancel() {
    setCanceling(true);
    try {
      const result = await cancelSubscription();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Your membership ends on ${new Date(result.endsAt).toLocaleDateString()}.`);
      setCancelDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.mySubscription(authUser?.id) });
    } finally {
      setCanceling(false);
    }
  }
  const [defaultHubId, setDefaultHubId] = useState<string>(() => localDefaultHubId() ?? HUBS[0].id);

  useEffect(() => {
    if (!isOpen || !authUser) return;
    let cancelled = false;
    fetchDefaultHubId(authUser.id).then((id) => {
      if (!cancelled && id) setDefaultHubId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, authUser]);
  const [exporting, setExporting] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const newPasswordOk = passwordChecks.every((c) => c.test(newPassword));

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || newEmail === authUser?.email) return;
    setEmailSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) throw error;
      toast.success("Check both your old and new inbox to confirm the email change.");
      setNewEmail("");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update email."));
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!newPasswordOk || newPassword !== confirmPassword || !authUser?.email) return;
    setPasswordSubmitting(true);
    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: authUser.email,
        password: currentPassword,
      });
      if (reauthError) throw new Error("Current password is incorrect.");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update password."));
    } finally {
      setPasswordSubmitting(false);
    }
  }

  async function downloadData() {
    if (!authUser || exporting) return;
    setExporting(true);
    try {
      const [profile, outfits, posts, favorites] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", authUser.id).maybeSingle(),
        supabase.from("outfits").select("*").eq("user_id", authUser.id),
        supabase.from("posts").select("*").eq("user_id", authUser.id),
        supabase.from("user_favorites").select("*").eq("user_id", authUser.id),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        account: { id: authUser.id, email: authUser.email },
        profile: profile.data,
        outfits: outfits.data ?? [],
        posts: posts.data ?? [],
        favorites: favorites.data ?? [],
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "mila-data-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const heading = {
    membership: { title: "Your Atelier", sub: "Client Dossier & Passes" },
    preferences: { title: "Preferences", sub: "Account Configuration" },
    location: { title: "Default Location", sub: "Climate Sync Hub" },
    privacy: { title: "Privacy & Data", sub: "Your Information" },
    security: { title: "Email & Security", sub: "Login Credentials" },
  }[view];

  const missing = [
    !user.season && "Color Season",
    !user.faceShape && "Face Shape",
    !user.hairType && "Hair Type",
  ].filter(Boolean) as string[];

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col bg-background">
        <SheetHeader className="px-6 pt-8 pb-5 border-b border-porcelain/40 flex flex-row items-end justify-between space-y-0">
          <div className="space-y-1 text-left">
            <SheetTitle className="font-serif text-2xl text-ink tracking-wide">
              {heading.title}
            </SheetTitle>
            <SheetDescription className="text-micro uppercase tracking-label-wide text-stone">
              {heading.sub}
            </SheetDescription>
          </div>

          <button
            onClick={() =>
              setView(
                view === "membership"
                  ? "preferences"
                  : view === "preferences"
                    ? "membership"
                    : "preferences",
              )
            }
            className="text-micro uppercase tracking-label-tight text-stone hover:text-ink transition-colors underline underline-offset-4 pb-1"
          >
            {view === "membership"
              ? "Settings"
              : view === "preferences"
                ? "Back to Profile"
                : "Back to Preferences"}
          </button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {view === "membership" ? (
            <div className="space-y-8">
              <div className="relative overflow-hidden rounded-2xl border border-porcelain/60 bg-linear-to-br from-atelier-champagne/25 via-background to-porcelain/20 p-4 shadow-atelier-soft">
                <div className="relative grid grid-cols-[auto_1fr_auto] items-center gap-3">
                  <div className="flex size-14 shrink-0 items-center justify-center rounded-full border border-white/70 bg-background/70 font-serif text-xl text-ink shadow-atelier-soft">
                    {(user.fullName[0] || user.username[0] || "M").toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-serif text-lg text-ink">
                      <span className="truncate">{user.fullName}</span>
                      {subscription && <VerifiedBadge className="size-4" />}
                    </p>
                    <p className="truncate text-label text-stone">@{user.username}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-pico uppercase tracking-label-tight">
                      <span className="rounded-full border border-porcelain/70 bg-background/60 px-2 py-1 text-ink">
                        Season · {user.season ?? "Unset"}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-1 ${user.faceShape ? "border-porcelain/70 bg-background/60 text-ink" : "border-amber-400/40 bg-amber-50/60 text-amber-700"}`}
                      >
                        Face · {user.faceShape ?? "—"}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-1 ${user.hairType ? "border-porcelain/70 bg-background/60 text-ink" : "border-amber-400/40 bg-amber-50/60 text-amber-700"}`}
                      >
                        Hair · {user.hairType ?? "—"}
                      </span>
                    </div>
                  </div>
                  {authUser && (
                    <Link
                      to="/profile/$userId"
                      params={{ userId: authUser.id }}
                      onClick={onClose}
                      className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-porcelain/70 bg-background/60 px-3 text-pico uppercase tracking-label-tight text-ink transition-colors hover:bg-background"
                    >
                      View Profile
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </Link>
                  )}
                </div>
                {missing.length > 0 && (
                  <Link
                    to="/style-profile"
                    onClick={onClose}
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-50/60 px-3 py-2 text-nano uppercase tracking-label text-amber-800 transition-colors hover:bg-amber-50"
                  >
                    <AlertCircle className="size-3" strokeWidth={1.6} />
                    Complete {missing.join(", ")} in the Studio
                  </Link>
                )}
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-porcelain/50 bg-linear-to-br from-atelier-champagne/30 via-background to-porcelain/20 p-6 shadow-atelier-soft">
                <div
                  aria-hidden
                  className="absolute -top-16 -right-16 h-44 w-44 rounded-full bg-atelier-champagne/30 blur-3xl pointer-events-none"
                />
                <div className="relative space-y-6">
                  <div className="flex items-end justify-between">
                    <span className="text-micro uppercase tracking-label-wide text-stone">
                      Concierge Access
                    </span>
                    <div className="text-right">
                      <div className="font-serif text-2xl text-ink leading-none">Atelier</div>
                      <div className="text-micro uppercase tracking-label text-stone mt-1">
                        Membership
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="uppercase tracking-label text-stone text-micro">
                        Current Tier
                      </span>
                      <span className="font-semibold text-ink">
                        {subscription ? subscription.plan_title : "Free"}
                      </span>
                    </div>
                    {subscription ? (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="uppercase tracking-label text-micro text-stone">
                            {subscription.cancel_at_period_end ? "Ends" : "Renews"}
                          </span>
                          <span className="font-semibold text-ink">
                            {subscription.current_period_end
                              ? new Date(subscription.current_period_end).toLocaleDateString()
                              : "—"}
                          </span>
                        </div>
                        {subscription.cancel_at_period_end ? (
                          <button
                            type="button"
                            onClick={handleResume}
                            disabled={resuming}
                            className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-label uppercase tracking-label-wide text-ink hover:bg-accent-soft dark:hover:bg-white/10 transition-colors disabled:opacity-60"
                          >
                            {resuming ? "Renewing…" : "Renew Membership"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setCancelDialogOpen(true)}
                            className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-label uppercase tracking-label-wide text-ink hover:bg-accent-soft dark:hover:bg-white/10 transition-colors"
                          >
                            Cancel Membership
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="pt-1 text-xs leading-relaxed text-stone">
                          Compare Atelier memberships and their included styling credits on the
                          plans page.
                        </p>
                        <Link
                          to="/pricing"
                          onClick={onClose}
                          className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-label uppercase tracking-label-wide text-ink hover:bg-accent-soft dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                        >
                          View Membership Plans
                          <span aria-hidden="true">→</span>
                        </Link>
                      </>
                    )}
                  </div>

                  {(subscription || (credits ?? 0) > 0) && (
                    <CreditsUsageMeter
                      remaining={credits ?? DEFAULT_AI_CREDITS}
                      total={subscription?.credits_included ?? DEFAULT_AI_CREDITS}
                    />
                  )}

                  {subscription && (
                    <p className="text-micro text-center leading-relaxed text-stone">
                      {(credits ?? 0) === 0
                        ? "You're out of credits for today — "
                        : "Run out before the day resets? "}
                      <Link
                        to="/credit-packs"
                        onClick={onClose}
                        className="text-ink underline underline-offset-2 hover:text-accent"
                      >
                        buy a credit pack
                      </Link>{" "}
                      to keep styling with Mila.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-px rounded-xl overflow-hidden border border-porcelain/40">
                <Link
                  to="/style-profile"
                  onClick={onClose}
                  className="flex items-center justify-between px-5 py-4 bg-background hover:bg-porcelain/20 transition-colors border-b border-porcelain/30"
                >
                  <span className="text-xs uppercase tracking-label text-ink">
                    Review Color Dossier
                  </span>
                  <span className="text-stone">→</span>
                </Link>
                <Link
                  to="/history"
                  onClick={onClose}
                  className="flex items-center justify-between px-5 py-4 bg-background hover:bg-porcelain/20 transition-colors"
                >
                  <span className="text-xs uppercase tracking-label text-ink flex items-center gap-2">
                    <Archive className="size-3.5" strokeWidth={1.75} />
                    Outfit Archive
                  </span>
                  <span className="text-stone">→</span>
                </Link>
              </div>
            </div>
          ) : view === "preferences" ? (
            <div className="space-y-8">
              <div className="space-y-3">
                <p className="text-micro uppercase tracking-label-wide text-stone">
                  Account details
                </p>
                <div className="rounded-xl border border-porcelain/40 overflow-hidden">
                  <button
                    onClick={() => setView("security")}
                    className="w-full flex items-center justify-between px-5 py-4 bg-background hover:bg-porcelain/20 transition-colors border-b border-porcelain/30"
                  >
                    <span className="text-sm text-ink">Email &amp; Security</span>
                    <span className="text-stone">→</span>
                  </button>
                  <div className="flex items-center justify-between px-5 py-4">
                    <span className="text-sm text-ink">Membership Tier</span>
                    <span className="text-micro uppercase tracking-label text-stone">Free</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-micro uppercase tracking-label-wide text-stone">
                  Styling parameters
                </p>
                <div className="rounded-xl border border-porcelain/40 overflow-hidden divide-y divide-porcelain/30">
                  <div className="flex items-center justify-between px-5 py-4">
                    <span className="text-sm text-ink">Climate Measurement</span>
                    <span className="text-micro uppercase tracking-label text-stone">
                      Celsius (°C)
                    </span>
                  </div>
                  <button
                    onClick={() => setView("location")}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-porcelain/20 transition-colors"
                  >
                    <span className="text-sm text-ink">Default Location</span>
                    <span className="flex items-center gap-3">
                      <span className="text-micro uppercase tracking-label text-stone">
                        {HUBS.find((h) => h.id === defaultHubId)?.city}
                      </span>
                      <span className="text-stone">→</span>
                    </span>
                  </button>
                  <button
                    onClick={() => setView("privacy")}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-porcelain/20 transition-colors"
                  >
                    <span className="text-sm text-ink">Privacy &amp; Data</span>
                    <span className="text-stone">→</span>
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-porcelain/30">
                <button
                  onClick={() => signOut()}
                  disabled={signingOut}
                  className="w-full py-3 rounded-lg border border-destructive/30 text-destructive text-label uppercase tracking-label-wide hover:bg-destructive/5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {signingOut && <Loader2 className="size-3.5 animate-spin" />}
                  {signingOut ? "Signing Out…" : "Sign Out of Studio"}
                </button>
              </div>
            </div>
          ) : view === "location" ? (
            <div className="space-y-3">
              <p className="text-micro uppercase tracking-label-wide text-stone">
                Climate sync hub
              </p>
              <div className="rounded-xl border border-porcelain/40 overflow-hidden divide-y divide-porcelain/30">
                {HUBS.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setDefaultHubId(h.id);
                      void saveDefaultHubId(authUser?.id, h.id);
                      setView("preferences");
                    }}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-porcelain/20 transition-colors"
                  >
                    <span className="text-sm text-ink">{h.city}</span>
                    <span className="flex items-center gap-3 text-micro uppercase tracking-label text-stone">
                      {h.tagline}
                      {defaultHubId === h.id && (
                        <Check className="size-3.5 text-ink" strokeWidth={1.6} />
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-micro text-stone leading-relaxed px-1">
                Your default hub sets the dashboard climate sync each time you open the studio.
              </p>
            </div>
          ) : view === "security" ? (
            <div className="space-y-8">
              <form onSubmit={changeEmail} className="space-y-3">
                <p className="text-micro uppercase tracking-label-wide text-stone">Email address</p>
                <p className="text-xs text-stone">
                  Current: <span className="text-ink">{authUser?.email}</span>
                </p>
                <Input
                  type="email"
                  placeholder="new@email.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="h-10"
                />
                <button
                  type="submit"
                  disabled={emailSubmitting || !newEmail.trim() || newEmail === authUser?.email}
                  className="w-full py-3 rounded-lg bg-ink text-white text-label uppercase tracking-label-wide font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50"
                >
                  {emailSubmitting ? "Sending confirmation…" : "Update Email"}
                </button>
              </form>

              <form
                onSubmit={changePassword}
                className="space-y-3 pt-6 border-t border-porcelain/30"
              >
                <p className="text-micro uppercase tracking-label-wide text-stone">
                  Change password
                </p>
                <Input
                  type="password"
                  placeholder="Current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="h-10"
                />
                <Input
                  type="password"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-10"
                />
                <Input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
                            ok ? "text-emerald-600" : "text-stone"
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
                <button
                  type="submit"
                  disabled={
                    passwordSubmitting ||
                    !currentPassword ||
                    !newPasswordOk ||
                    newPassword !== confirmPassword
                  }
                  className="w-full py-3 rounded-lg bg-ink text-white text-label uppercase tracking-label-wide font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50"
                >
                  {passwordSubmitting ? "Updating…" : "Update Password"}
                </button>
              </form>

              <div className="space-y-3 pt-6 border-t border-destructive/20">
                <p className="text-micro uppercase tracking-label-wide text-destructive">
                  Delete account
                </p>
                <p className="text-xs text-stone leading-relaxed">
                  This erases your profile, looks, posts, favorites and uploaded photos for good.
                  Any active membership is canceled at once. This cannot be undone.
                </p>
                <label htmlFor="delete-confirm-email" className="block text-label text-stone">
                  Type <span className="text-ink font-medium">{authUser?.email}</span> to confirm.
                </label>
                <Input
                  id="delete-confirm-email"
                  type="email"
                  autoComplete="off"
                  placeholder={authUser?.email ?? "your@email.com"}
                  value={deleteEmail}
                  onChange={(e) => setDeleteEmail(e.target.value)}
                  className="h-10"
                />
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={!deleteEmailMatches || deleting}
                  className="w-full py-3 rounded-lg border border-destructive/30 text-destructive text-label uppercase tracking-label-wide hover:bg-destructive/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleting && <Loader2 className="size-3.5 animate-spin" />}
                  {deleting ? "Deleting…" : "Delete My Account"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="space-y-3">
                <p className="text-micro uppercase tracking-label-wide text-stone">Your data</p>
                <p className="text-xs text-stone leading-relaxed">
                  Mila stores your style profile, outfit analyses, community posts, and favorites to
                  tailor your recommendations. Your data is never sold and is only used within the
                  studio.
                </p>
                <button
                  onClick={downloadData}
                  disabled={exporting}
                  className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-label uppercase tracking-label-wide text-ink hover:bg-accent-soft dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-3 disabled:opacity-60"
                >
                  {exporting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" strokeWidth={1.75} />
                  )}
                  <span>{exporting ? "Preparing export…" : "Download My Data"}</span>
                </button>
                <p className="text-micro text-stone leading-relaxed">
                  Exports your profile, outfits, posts, and favorites as JSON.
                </p>
              </div>

              <div className="pt-4 border-t border-porcelain/30 space-y-3">
                <p className="text-micro uppercase tracking-label-wide text-stone">
                  Account removal
                </p>
                <p className="text-micro text-stone leading-relaxed">
                  You can permanently delete your account and all associated data yourself, under
                  Email &amp; Security.
                </p>
                <button
                  onClick={() => setView("security")}
                  className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-label uppercase tracking-label-wide text-ink hover:bg-accent-soft dark:hover:bg-white/10 transition-colors"
                >
                  Go to Email &amp; Security
                </button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>

      {subscription && !subscription.cancel_at_period_end && (
        <CancelMembershipDialog
          open={cancelDialogOpen}
          endsAt={subscription.current_period_end ?? new Date().toISOString()}
          pending={canceling}
          onOpenChange={setCancelDialogOpen}
          onConfirm={handleConfirmCancel}
        />
      )}
    </Sheet>
  );
}
