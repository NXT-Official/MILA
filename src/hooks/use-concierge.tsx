import { createContext, useContext } from "react";

/**
 * A saved look the Concierge conversation is anchored to. `lookId` is the
 * trusted identifier — the server re-resolves the image and details from the
 * user's own `outfits` row; `imageUrl`/`title`/`source` here are only for
 * the drawer's preview card.
 */
export interface ConciergeLook {
  lookId: string;
  imageUrl: string | null;
  title: string;
  /** Where the anchor came from, e.g. "From History" or "Studio Lens". */
  source: string;
}

interface ConciergeApi {
  /** Open the Concierge drawer. Pass a look to anchor it; omit for general mode. */
  openConcierge: (look?: ConciergeLook | null) => void;
}

export const ConciergeContext = createContext<ConciergeApi | null>(null);

export function useConcierge(): ConciergeApi {
  const ctx = useContext(ConciergeContext);
  if (!ctx) throw new Error("useConcierge must be used within the authenticated app shell");
  return ctx;
}
