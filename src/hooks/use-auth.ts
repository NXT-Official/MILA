import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signingOut: boolean;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthCtx | undefined>(undefined);

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
