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
    status: "available",
    label: "In development",
    description:
      "Membership purchasing is still in development. Your existing daily credits continue to work as usual.",
  },
  creditEnforcement: {
    status: "available",
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
