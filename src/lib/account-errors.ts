import { isStaleBundleError } from "@/lib/utils";

export type MembershipAction = "cancel" | "resume";

export type MembershipActionOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

const FAILED_COPY: Record<MembershipAction, string> = {
  cancel: "We couldn't cancel your membership just now. Nothing has changed. Please try again.",
  resume: "We couldn't renew your membership just now. Nothing has changed. Please try again.",
};

const STALE_COPY = "Mila was updated while this page was open. Refresh the page and try again.";

/**
 * Runs a cancel/resume server call and turns every way it can go wrong into
 * one calm sentence. The server already returns friendly `{ error }` text for
 * the failures it knows about; this covers the rest (network drop, a stale
 * tab, a rejected request) so the button never just stops spinning, and no
 * raw error text reaches the screen.
 */
export async function runMembershipAction<T extends object>(
  action: MembershipAction,
  call: () => Promise<T | { error: string }>,
): Promise<MembershipActionOutcome<T>> {
  try {
    const result = await call();
    if ("error" in result && typeof result.error === "string") {
      return { ok: false, message: result.error };
    }
    return { ok: true, value: result as T };
  } catch (err) {
    return { ok: false, message: isStaleBundleError(err) ? STALE_COPY : FAILED_COPY[action] };
  }
}
