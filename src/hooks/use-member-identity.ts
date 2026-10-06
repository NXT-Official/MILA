import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { memberIdentity, type MemberIdentity } from "@/lib/member-identity";
import { profileQueryOptions } from "@/lib/queries/profile";
import { profileUsernameQueryOptions } from "@/lib/queries/profile-username";

/** The signed-in member's display name and `@handle`, from their profile. */
export function useMemberIdentity(): MemberIdentity {
  const { user } = useAuth();
  const { data: profile } = useQuery({
    ...profileQueryOptions(user?.id),
    enabled: !!user?.id,
  });
  const { data: username } = useQuery(profileUsernameQueryOptions(user?.id));
  return memberIdentity({ fullName: profile?.full_name, username });
}
