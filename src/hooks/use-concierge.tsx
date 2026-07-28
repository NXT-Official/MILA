import { createContext, useContext } from "react";

export interface ConciergeLook {
  lookId: string;
  imageUrl: string | null;
  title: string;
  source: string;
}

interface ConciergeApi {
  openConcierge: (look?: ConciergeLook | null) => void;
  look: ConciergeLook | null;
  clearLook: () => void;
}

export const ConciergeContext = createContext<ConciergeApi | null>(null);

export function useConcierge(): ConciergeApi {
  const ctx = useContext(ConciergeContext);
  if (!ctx) throw new Error("useConcierge must be used within the authenticated app shell");
  return ctx;
}
