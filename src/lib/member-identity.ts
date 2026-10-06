export interface MemberIdentity {
  /** What the member is called: their name if they set one, else their handle. */
  displayName: string;
  /** The `@handle` shown under the name, or null when there isn't one yet. */
  handle: string | null;
}

/**
 * Who a member is, from their profile alone. The sign-in email is private and
 * must never stand in for a name or handle, so it is not an input here.
 */
export function memberIdentity(input: {
  fullName?: string | null;
  username?: string | null;
}): MemberIdentity {
  const handle = input.username?.trim() || null;
  return {
    displayName: input.fullName?.trim() || handle || "Member",
    handle,
  };
}
