import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { GeneratedLook } from "@/lib/generate-outfit.functions";

export interface CurrentLookSavedRef {
  id: string;
  imageUrl: string;
}

interface CurrentLookApi {
  look: GeneratedLook | null;
  setLook: Dispatch<SetStateAction<GeneratedLook | null>>;
  styleSheetImageDataUri: string | null;
  setStyleSheetImageDataUri: Dispatch<SetStateAction<string | null>>;
  savedLook: CurrentLookSavedRef | null;
  setSavedLook: Dispatch<SetStateAction<CurrentLookSavedRef | null>>;
  /**
   * Compose/render orchestration flags. Held HERE, at the app shell, because
   * a member who switches tabs mid-generation unmounts the dashboard: the
   * same flags kept as route-local state would reset to idle, the returning
   * member would see no progress, and the re-enabled CTA would be one tap
   * away from paying for a second generation while the first still runs. The
   * setters are stable across mounts, so a request that settles after the
   * dashboard unmounted still clears its flag — and the member returns to the
   * in-progress state, not an idle page.
   */
  generating: boolean;
  setGenerating: Dispatch<SetStateAction<boolean>>;
  styleSheetLoading: boolean;
  setStyleSheetLoading: Dispatch<SetStateAction<boolean>>;
  photoPreviewLoading: boolean;
  setPhotoPreviewLoading: Dispatch<SetStateAction<boolean>>;
}

export const CurrentLookContext = createContext<CurrentLookApi | null>(null);

/**
 * The most recently generated Daily Look, kept alive at the app-shell layer
 * instead of local route state — Dashboard previously stored this in its own
 * useState, so switching tabs and coming back unmounted the route and lost
 * the visual the user just generated. Cleared only when the user explicitly
 * starts a new generation (see Dashboard's generateLook).
 */
export function useCurrentLook(): CurrentLookApi {
  const ctx = useContext(CurrentLookContext);
  if (!ctx) throw new Error("useCurrentLook must be used within the authenticated app shell");
  return ctx;
}
