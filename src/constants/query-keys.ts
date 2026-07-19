export const queryKeys = {
  profile: (userId: string | undefined) => ["profile", userId] as const,
  feed: (userId: string | undefined) => ["feed", userId] as const,
  memberProfile: (userId: string) => ["member-profile", userId] as const,
  suspended: (userId: string | undefined) => ["suspended", userId] as const,
  credits: (userId: string | undefined) => ["credits", userId] as const,
  conciergeConversations: (userId: string | undefined) =>
    ["concierge-conversations", userId] as const,
  staffGate: ["staff:gate"] as const,
  adminUsers: ["admin:users"] as const,
  adminPosts: ["admin:posts"] as const,
  adminSupportMessages: ["admin:support-messages"] as const,
  adminDashboard: ["admin:dashboard"] as const,
  adminSubscriptionPlans: ["admin:subscription-plans"] as const,
  subscriptionPlans: ["subscription-plans"] as const,
};
