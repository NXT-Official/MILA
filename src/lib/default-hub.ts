import { supabase } from "@/integrations/supabase/client";
import { HUBS, DEFAULT_HUB_STORAGE_KEY } from "@/constants/climate";

function validHubId(id: string | null | undefined): string | null {
  return id && HUBS.some((h) => h.id === id) ? id : null;
}

export function localDefaultHubId(): string | null {
  try {
    return validHubId(localStorage.getItem(DEFAULT_HUB_STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function fetchDefaultHubId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("default_location")
    .eq("id", userId)
    .maybeSingle();
  const remote = validHubId(data?.default_location);
  if (remote) {
    try {
      localStorage.setItem(DEFAULT_HUB_STORAGE_KEY, remote);
    } catch {}
    return remote;
  }
  const local = localDefaultHubId();
  // Quiet back-fill of a hub chosen before she signed in. If it fails the
  // local copy still drives the dashboard and the next load tries again.
  if (local) void saveDefaultHubId(userId, local).catch(() => {});
  return local;
}

export type ProfileHubWriter = (
  userId: string,
  hubId: string,
) => Promise<{ rows: number; error: { message?: string } | null }>;

const writeProfileHub: ProfileHubWriter = async (userId, hubId) => {
  const { data, error } = await supabase
    .from("profiles")
    .update({ default_location: hubId })
    .eq("id", userId)
    .select("id");
  return { rows: data?.length ?? 0, error };
};

/**
 * Saves the default hub. Resolves only once the choice is really stored, and
 * rejects otherwise, so a caller can never tell her it was saved when it was
 * not. PostgREST answers 200 to an UPDATE that matched no row (RLS hides it,
 * or the row is missing), so the number of rows written is checked as well as
 * the error. The local copy is written only after the database accepts the
 * change; writing it first would let the next load read the old remote value
 * and quietly undo her pick.
 */
export async function saveDefaultHubId(
  userId: string | null | undefined,
  hubId: string,
  write: ProfileHubWriter = writeProfileHub,
): Promise<void> {
  if (userId) {
    const { rows, error } = await write(userId, hubId);
    if (error || rows < 1) throw new Error("Your default location could not be saved.");
  }
  try {
    localStorage.setItem(DEFAULT_HUB_STORAGE_KEY, hubId);
  } catch {}
}

/**
 * What to do when a hub save settles. The save is async, so by then she may
 * have tapped Back: a save that lands late must not drag her to Preferences,
 * and a failure she can no longer see inline has to surface some other way.
 */
export function hubSaveFollowUp(ok: boolean, stillOnLocation: boolean) {
  return {
    adoptHub: ok,
    goToPreferences: ok && stillOnLocation,
    inlineRetry: !ok && stillOnLocation,
    toastFailure: !ok && !stillOnLocation,
  };
}

/**
 * `saveDefaultHubId` for UI callers: a result to branch on instead of an
 * exception to remember to catch. `ok: false` means nothing was saved.
 */
export async function attemptSaveDefaultHub(
  userId: string | null | undefined,
  hubId: string,
  write?: ProfileHubWriter,
): Promise<{ ok: boolean }> {
  try {
    await saveDefaultHubId(userId, hubId, write);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
