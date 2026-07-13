import { supabase } from "@/integrations/supabase/client";
import { HUBS, DEFAULT_HUB_STORAGE_KEY } from "@/constants/climate";

// profiles.default_location is the source of truth; localStorage is only an
// offline/pre-auth cache. First read after sign-in migrates a legacy
// localStorage-only value up into the profile.

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
    } catch {
      /* private mode etc. — cache only */
    }
    return remote;
  }
  const local = localDefaultHubId();
  if (local) void saveDefaultHubId(userId, local); // one-time migration
  return local;
}

export async function saveDefaultHubId(
  userId: string | null | undefined,
  hubId: string,
): Promise<void> {
  try {
    localStorage.setItem(DEFAULT_HUB_STORAGE_KEY, hubId);
  } catch {
    /* cache only */
  }
  if (userId) {
    await supabase.from("profiles").update({ default_location: hubId }).eq("id", userId);
  }
}
