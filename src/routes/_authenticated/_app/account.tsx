import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { errorMessage } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useMemberIdentity } from "@/hooks/use-member-identity";
import { useLiveValue } from "@/hooks/use-live-value";
import { useMinWidth } from "@/hooks/use-min-width";
import { supabase } from "@/integrations/supabase/client";
import { useCaptcha } from "@/components/login/use-captcha";
import { HUBS } from "@/constants/climate";
import { passwordChecks } from "@/constants/password";
import {
  attemptSaveDefaultHub,
  fetchDefaultHubId,
  hubSaveFollowUp,
  localDefaultHubId,
} from "@/lib/default-hub";
import { runMembershipAction } from "@/lib/account-errors";
import { fetchAccountExport, type ExportClient } from "@/lib/account-export";
import { getSignInMethods } from "@/lib/auth-identities";
import { requestEmailChange } from "@/lib/email-change";
import { queryKeys } from "@/constants/query-keys";
import { profileQueryOptions } from "@/lib/queries/profile";
import { creditsQueryOptions } from "@/lib/queries/credits";
import { mySubscriptionQueryOptions } from "@/lib/queries/subscriptions";
import { cancelMySubscription, resumeMySubscription } from "@/lib/subscriptions.functions";
import { deleteMyAccount, notifyPasswordChanged } from "@/lib/account.functions";
import { CancelMembershipDialog } from "@/components/account/cancel-membership-dialog";
import { AccountShell } from "@/components/account/account-menu";
import { SavedPiecesAccountRow } from "@/components/saved/saved-pieces-link";
import {
  planSectionChange,
  sanitizeAccountSection,
  validateAccountSearch,
  type AccountSection,
} from "@/components/account/account-sections";
import { MembershipView } from "@/components/account/drawer-views/membership-view";
import { PreferencesView } from "@/components/account/drawer-views/preferences-view";
import { LocationView } from "@/components/account/drawer-views/location-view";
import { SecurityView } from "@/components/account/drawer-views/security-view";
import { PrivacyView } from "@/components/account/drawer-views/privacy-view";
import { PageHeader } from "@/components/ui/page-header";

export const Route = createFileRoute("/_authenticated/_app/account")({
  validateSearch: validateAccountSearch,
  component: AccountPage,
});

const noop = () => {};

function AccountPage() {
  // The open section lives in the URL (?section=security): browser and phone
  // Back return to the list, and a section can be linked to. null = still on
  // the list (the whole screen on phone and tablet); from lg up the list sits
  // beside the content and Membership shows by default.
  // src: https://tanstack.com/router/latest/docs/framework/react/guide/search-params · @tanstack/react-router 1.170.41
  // The router merges raw URL params into what useSearch() returns, so an
  // unknown id can still arrive here: sanitize again and fall back to the list.
  const { section: searchSection } = Route.useSearch();
  const section: AccountSection | null = sanitizeAccountSection(searchSection) ?? null;
  const navigate = Route.useNavigate();
  // 64rem is Tailwind's `lg`, where the layout switches to list + content.
  const wide = useMinWidth("64rem");
  // Async saves read the section they settle in, not the one they started in,
  // and null once she has left the page altogether (see useLiveValue).
  const sectionRef = useLiveValue(section);
  // True while the entry just before this one is the list, so the in-page Back
  // can be a real history Back instead of stacking another list entry.
  const cameFromList = useRef(false);
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
  const notifyPasswordChangedFn = useServerFn(notifyPasswordChanged);
  const captcha = useCaptcha();
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

  // Both calls can reject (network drop, stale tab); runMembershipAction turns
  // every failure into one calm sentence so the button never just stops spinning.
  async function handleResume() {
    setResuming(true);
    const outcome = await runMembershipAction("resume", () => resumeSubscription());
    setResuming(false);
    if (!outcome.ok) {
      toast.error(outcome.message);
      return;
    }
    toast.success(
      `Your membership renews on ${new Date(outcome.value.renewsAt).toLocaleDateString()}.`,
    );
    queryClient.invalidateQueries({ queryKey: queryKeys.mySubscription(authUser?.id) });
  }

  async function handleConfirmCancel() {
    setCanceling(true);
    const outcome = await runMembershipAction("cancel", () => cancelSubscription());
    setCanceling(false);
    if (!outcome.ok) {
      toast.error(outcome.message);
      return;
    }
    toast.success(
      `Your membership ends on ${new Date(outcome.value.endsAt).toLocaleDateString()}.`,
    );
    setCancelDialogOpen(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.mySubscription(authUser?.id) });
  }

  const [defaultHubId, setDefaultHubId] = useState<string>(() => localDefaultHubId() ?? HUBS[0].id);
  const [savingHubId, setSavingHubId] = useState<string | null>(null);
  const [failedHubId, setFailedHubId] = useState<string | null>(null);

  async function handleSelectHub(hubId: string) {
    setSavingHubId(hubId);
    setFailedHubId(null);
    const { ok } = await attemptSaveDefaultHub(authUser?.id, hubId);
    setSavingHubId(null);
    // She may have tapped Back while this was saving: a late save must not pull
    // her to Preferences, and a failure she can no longer see inline is a toast.
    const next = hubSaveFollowUp(ok, sectionRef.current === "location");
    if (next.inlineRetry) setFailedHubId(hubId);
    if (next.toastFailure) {
      toast.error("We couldn't save your default location. Open Default Location to try again.");
    }
    if (next.adoptHub) {
      setDefaultHubId(hubId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(authUser?.id) });
    }
    if (next.goToPreferences) openSection("preferences");
  }

  // Going from the list into a section is the one history entry (so phone Back
  // returns to the list); moves between sections replace it. See planSectionChange.
  function openSection(next: AccountSection | null) {
    setFailedHubId(null);
    const plan = planSectionChange(section, next, { wide, cameFromList: cameFromList.current });
    cameFromList.current = plan.cameFromList;
    if (plan.kind === "history-back") {
      window.history.back();
      return;
    }
    void navigate({
      search: plan.section ? { section: plan.section } : {},
      replace: plan.replace,
    });
  }

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
      // The confirmation link returns her to this deployment's Account page.
      const { error } = await requestEmailChange(supabase.auth, newEmail, window.location.origin);
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
    if (!captcha.token) {
      toast.error("Please complete the captcha challenge.");
      return;
    }
    setPasswordSubmitting(true);
    try {
      // The re-auth is a password grant, and the project enforces hCaptcha on
      // those — without a token every attempt dies server-side with
      // `captcha_failed` and a correct password reads as wrong.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: authUser.email,
        password: currentPassword,
        options: { captchaToken: captcha.token },
      });
      if (reauthError) {
        if (reauthError.code === "captcha_failed") {
          throw new Error("The human check didn't go through. Verify again and retry.");
        }
        throw new Error("Current password is incorrect.");
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      // Mila emails a receipt of the change. The password is already updated, so
      // a failure here is logged server-side and never surfaces as an error.
      void notifyPasswordChangedFn().catch(() => {});
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update password."));
    } finally {
      // Tokens are single-use — reset after every attempt, pass or fail.
      captcha.reset();
      setPasswordSubmitting(false);
    }
  }

  async function downloadData() {
    if (!authUser || exporting) return;
    setExporting(true);
    try {
      // Typed as a loose client on purpose: `saved_products` comes from a
      // migration that may not be applied yet, so it is not in the generated
      // types and must be skipped quietly when the table is missing.
      const result = await fetchAccountExport(
        { id: authUser.id, email: authUser.email },
        supabase as unknown as ExportClient,
      );
      if (!result.ok) {
        // A file with rows missing would look complete and not be. Say what
        // could not be included and let her retry rather than hand over a
        // partial export.
        toast.error(result.message);
        return;
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result.payload, null, 2)], { type: "application/json" }),
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

  const { displayName, handle } = useMemberIdentity();
  const signInMethods = getSignInMethods(authUser);
  const shownSection: AccountSection = section ?? "membership";

  return (
    <div className="atelier-page">
      <PageHeader
        kicker="Account"
        title="Your account."
        description="Membership, preferences and security, all in one place."
      />

      <AccountShell
        section={section}
        wide={wide}
        onSelect={openSection}
        onBack={() => openSection(null)}
        menuFooter={<SavedPiecesAccountRow />}
      >
        {shownSection === "membership" ? (
          <MembershipView
            user={{
              fullName: displayName,
              username: handle,
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
        ) : shownSection === "preferences" ? (
          <PreferencesView
            defaultHubId={defaultHubId}
            onNavigate={openSection}
            onSignOut={() => signOut()}
            signingOut={signingOut}
          />
        ) : shownSection === "location" ? (
          <LocationView
            defaultHubId={defaultHubId}
            onSelectHub={handleSelectHub}
            savingHubId={savingHubId}
            failedHubId={failedHubId}
          />
        ) : shownSection === "security" ? (
          <SecurityView
            authUserEmail={authUser?.email}
            newEmail={newEmail}
            onNewEmailChange={setNewEmail}
            emailSubmitting={emailSubmitting}
            onChangeEmail={changeEmail}
            hasPassword={signInMethods.hasPassword}
            signInProviders={signInMethods.providerLabels}
            currentPassword={currentPassword}
            onCurrentPasswordChange={setCurrentPassword}
            newPassword={newPassword}
            onNewPasswordChange={setNewPassword}
            confirmPassword={confirmPassword}
            onConfirmPasswordChange={setConfirmPassword}
            newPasswordOk={newPasswordOk}
            passwordSubmitting={passwordSubmitting}
            onChangePassword={changePassword}
            captchaField={captcha.field}
            captchaReady={Boolean(captcha.token)}
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
            onNavigateSecurity={() => openSection("security")}
          />
        )}
      </AccountShell>

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
