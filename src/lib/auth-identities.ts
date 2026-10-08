import type { User } from "@supabase/supabase-js";

export interface SignInMethods {
  /** True when the member can sign in with an email and password. */
  hasPassword: boolean;
  /** Plain names of the other ways they sign in, e.g. "Google". */
  providerLabels: string[];
}

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  facebook: "Facebook",
  github: "GitHub",
};

function labelFor(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * How this member signs in. A password only exists behind an `email`
 * identity, so an OAuth-only (e.g. Google) account has nothing to change.
 * When the user object carries no provider information at all we assume a
 * password exists, so a gap in the data never hides the form from someone who
 * needs it.
 */
// src: node_modules/@supabase/auth-js/dist/main/lib/types.d.ts (User.identities, UserAppMetadata.providers) · @supabase/auth-js 2.110.0
export function getSignInMethods(user: User | null | undefined): SignInMethods {
  if (!user) return { hasPassword: true, providerLabels: [] };

  const fromIdentities = (user.identities ?? []).map((i) => i.provider);
  const fromMetadata = [
    ...(user.app_metadata?.providers ?? []),
    ...(user.app_metadata?.provider ? [user.app_metadata.provider] : []),
  ];
  const providers = Array.from(new Set(fromIdentities.length > 0 ? fromIdentities : fromMetadata));

  if (providers.length === 0) return { hasPassword: true, providerLabels: [] };

  return {
    hasPassword: providers.includes("email"),
    providerLabels: providers.filter((p) => p !== "email").map(labelFor),
  };
}
