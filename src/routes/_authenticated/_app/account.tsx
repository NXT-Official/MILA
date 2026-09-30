import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn, errorMessage } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { HUBS } from "@/constants/climate";
import { passwordChecks } from "@/constants/password";
import { fetchDefaultHubId, localDefaultHubId, saveDefaultHubId } from "@/lib/default-hub";
import { queryKeys } from "@/constants/query-keys";
import { profileQueryOptions } from "@/lib/queries/profile";
import { creditsQueryOptions } from "@/lib/queries/credits";
import { mySubscriptionQueryOptions } from "@/lib/queries/subscriptions";
import { cancelMySubscription, resumeMySubscription } from "@/lib/subscriptions.functions";
import { deleteMyAccount } from "@/lib/account.functions";
import { CancelMembershipDialog } from "@/components/account/cancel-membership-dialog";
import { MembershipView } from "@/components/account/drawer-views/membership-view";
import { PreferencesView } from "@/components/account/drawer-views/preferences-view";
import { LocationView } from "@/components/account/drawer-views/location-view";
import { SecurityView } from "@/components/account/drawer-views/security-view";
import { PrivacyView } from "@/components/account/drawer-views/privacy-view";
import { PageHeader } from "@/components/ui/page-header";

export const Route = createFileRoute("/_authenticated/_app/account")({
  component: AccountPage,
});

type AccountSection = "membership" | "preferences" | "location" | "privacy" | "security";

const SECTIONS: { id: AccountSection; label: string }[] = [
  { id: "membership", label: "Membership" },
  { id: "preferences", label: "Preferences" },
  { id: "location", label: "Default Location" },
  { id: "security", label: "Email & Security" },
  { id: "privacy", label: "Privacy & Data" },
];

const noop = () => {};

function AccountPage() {
  const [section, setSection] = useState<AccountSection>("membership");
  const { user: authUser, signOut, signingOut } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    ...profileQueryOptions(authUser?.id),
    enabled: !!authUser?.id,
  });
  const { data: credits } = useQuery(creditsQueryOptions(authUser?.id));
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
    if (!authUser) return;
    let cancelled = false;
    fetchDefaultHubId(authUser.id).then((id) => {
      if (!cancelled && id) setDefaultHubId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [authUser]);

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
      const [profileRow, outfits, posts, favorites] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", authUser.id).maybeSingle(),
        supabase.from("outfits").select("*").eq("user_id", authUser.id),
        supabase.from("posts").select("*").eq("user_id", authUser.id),
        supabase.from("user_favorites").select("*").eq("user_id", authUser.id),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        account: { id: authUser.id, email: authUser.email },
        profile: profileRow.data,
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

  const displayName = profile?.full_name?.trim() || authUser?.email?.split("@")[0] || "Member";
  const username = authUser?.email?.split("@")[0] ?? "member";

  return (
    <div className="atelier-page">
      <PageHeader
        kicker="Account"
        title="Your account."
        description="Membership, preferences, and security — all in one place."
      />

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
        <nav aria-label="Account sections" className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? "page" : undefined}
              className={cn(
                "atelier-focus-ring shrink-0 rounded-control px-4 py-2.5 text-left text-sm transition-colors md:w-full",
                section === s.id
                  ? "bg-accent-soft/60 text-accent font-medium"
                  : "text-muted-foreground hover:bg-accent-soft/30 hover:text-ink",
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {section === "membership" ? (
            <MembershipView
              user={{
                fullName: displayName,
                username,
                season: profile?.color_season ?? null,
                faceShape: profile?.face_shape ?? null,
                hairType: profile?.hair_type ?? null,
              }}
              authUserId={authUser?.id}
              subscription={subscription}
              credits={credits ?? null}
              onClose={noop}
              resuming={resuming}
              onResume={handleResume}
              onCancelClick={() => setCancelDialogOpen(true)}
            />
          ) : section === "preferences" ? (
            <PreferencesView
              defaultHubId={defaultHubId}
              onNavigate={setSection}
              onSignOut={() => signOut()}
              signingOut={signingOut}
            />
          ) : section === "location" ? (
            <LocationView
              defaultHubId={defaultHubId}
              onSelectHub={(hubId) => {
                setDefaultHubId(hubId);
                void saveDefaultHubId(authUser?.id, hubId);
                setSection("preferences");
              }}
            />
          ) : section === "security" ? (
            <SecurityView
              authUserEmail={authUser?.email}
              newEmail={newEmail}
              onNewEmailChange={setNewEmail}
              emailSubmitting={emailSubmitting}
              onChangeEmail={changeEmail}
              currentPassword={currentPassword}
              onCurrentPasswordChange={setCurrentPassword}
              newPassword={newPassword}
              onNewPasswordChange={setNewPassword}
              confirmPassword={confirmPassword}
              onConfirmPasswordChange={setConfirmPassword}
              newPasswordOk={newPasswordOk}
              passwordSubmitting={passwordSubmitting}
              onChangePassword={changePassword}
              deleteEmail={deleteEmail}
              onDeleteEmailChange={setDeleteEmail}
              deleteEmailMatches={deleteEmailMatches}
              deleting={deleting}
              onDeleteAccount={handleDeleteAccount}
            />
          ) : (
            <PrivacyView
              exporting={exporting}
              onDownloadData={downloadData}
              onNavigateSecurity={() => setSection("security")}
            />
          )}
        </div>
      </div>

      {subscription && !subscription.cancel_at_period_end && (
        <CancelMembershipDialog
          open={cancelDialogOpen}
          endsAt={subscription.current_period_end ?? new Date().toISOString()}
          pending={canceling}
          onOpenChange={setCancelDialogOpen}
          onConfirm={handleConfirmCancel}
        />
      )}
    </div>
  );
}
