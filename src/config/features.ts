/**
 * Central feature-availability registry for deployment gating. This is the
 * single source of truth for "is X finished enough to ship" — components
 * read from here instead of declaring their own ad-hoc availability flags.
 *
 * This is NOT an authorization system: it only controls whether an
 * otherwise-reachable UI affordance is shown as active or as
 * "In development". Real permission checks (admin/owner/RLS) are unrelated
 * and must never be weakened or replaced by a feature's status here.
 *
 * See /IN_DEVELOPMENT.txt for the full deployment inventory this registry
 * documents.
 */

export type FeatureAvailability = "available" | "partial" | "development" | "disabled";

export interface FeatureDefinition {
  status: FeatureAvailability;
  label: string;
  description: string;
}

export const FEATURES = {
  creditPurchases: {
    status: "development",
    label: "In development",
    description: "Purchasing additional AI credits is not yet available in this release.",
  },
  membershipPasses: {
    status: "development",
    label: "In development",
    description: "Acquiring extra Studio passes is not yet available in this release.",
  },
  membershipPurchasing: {
    status: "development",
    label: "In development",
    description:
      "Membership purchasing is still in development. Your existing daily credits continue to work as usual.",
  },
  creditEnforcement: {
    status: "development",
    label: "In development",
    description:
      "AI credit consumption is not yet enforced — usage is currently unrestricted for this release.",
  },
  adRewards: {
    status: "development",
    label: "In development",
    description: "Rewarded advertisements are not yet integrated.",
  },
  moderatorRole: {
    status: "available",
    label: "Available",
    description: "Stewards can assign restricted moderation and support access.",
  },
  passwordReset: {
    status: "development",
    label: "In development",
    description: "Self-service password recovery is not yet available.",
  },
} satisfies Record<string, FeatureDefinition>;

export type FeatureKey = keyof typeof FEATURES;

export function isFeatureAvailable(feature: FeatureDefinition): boolean {
  return feature.status === "available";
}
