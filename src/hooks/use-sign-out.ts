import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

export function useSignOut() {
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't sign out.");
      setSigningOut(false);
    }
  }

  return { signingOut, handleSignOut };
}
