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
