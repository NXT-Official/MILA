import * as React from "react";
import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { HUBS } from "@/constants/climate";
import { passwordChecks } from "@/constants/password";
import { fetchDefaultHubId, localDefaultHubId, saveDefaultHubId } from "@/lib/default-hub";
import { queryKeys } from "@/constants/query-keys";
import { mySubscriptionQueryOptions } from "@/lib/queries/subscriptions";
import { cancelMySubscription, resumeMySubscription } from "@/lib/subscriptions.functions";
import { deleteMyAccount } from "@/lib/account.functions";
import { CancelMembershipDialog } from "@/components/account/cancel-membership-dialog";
import { errorMessage } from "@/lib/utils";
import { MembershipView } from "@/components/account/drawer-views/membership-view";
import { PreferencesView } from "@/components/account/drawer-views/preferences-view";
import { LocationView } from "@/components/account/drawer-views/location-view";
import { SecurityView } from "@/components/account/drawer-views/security-view";
import { PrivacyView } from "@/components/account/drawer-views/privacy-view";

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

type DrawerView = "membership" | "preferences" | "location" | "privacy" | "security";

export function StudioMembershipDrawer({
  isOpen,
  onClose,
  credits,
  user,
}: StudioMembershipDrawerProps) {
  const [view, setView] = useState<DrawerView>("membership");
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

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col bg-background">
        <SheetHeader className="px-6 pt-8 pb-5 border-b border-porcelain/30 flex flex-row items-end justify-between space-y-0">
          <div className="space-y-1 text-left">
            <SheetTitle className="font-serif text-2xl text-ink tracking-wide">
              {heading.title}
            </SheetTitle>
            <SheetDescription className="atelier-label">{heading.sub}</SheetDescription>
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
            <MembershipView
              user={user}
              authUserId={authUser?.id}
              subscription={subscription}
              credits={credits}
              onClose={onClose}
              resuming={resuming}
              onResume={handleResume}
              onCancelClick={() => setCancelDialogOpen(true)}
            />
          ) : view === "preferences" ? (
            <PreferencesView
              defaultHubId={defaultHubId}
              onNavigate={setView}
              onSignOut={() => signOut()}
              signingOut={signingOut}
            />
          ) : view === "location" ? (
            <LocationView
              defaultHubId={defaultHubId}
              onSelectHub={(hubId) => {
                setDefaultHubId(hubId);
                void saveDefaultHubId(authUser?.id, hubId);
                setView("preferences");
              }}
            />
          ) : view === "security" ? (
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
              onNavigateSecurity={() => setView("security")}
            />
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
