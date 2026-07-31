import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";

export function useSignOut() {
  const { signOut, signingOut } = useAuth();

  async function handleSignOut() {
    try {
      await signOut();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't sign out."));
    }
  }

  return { signingOut, handleSignOut };
}
