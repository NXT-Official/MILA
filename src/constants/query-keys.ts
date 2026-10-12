export const queryKeys = {
  profile: (userId: string | undefined) => ["profile", userId] as const,
  feed: (userId: string | undefined) => ["feed", userId] as const,
  memberProfile: (userId: string) => ["member-profile", userId] as const,
  suspended: (userId: string | undefined) => ["suspended", userId] as const,
  credits: (userId: string | undefined) => ["credits", userId] as const,
  mySubscription: (userId: string | undefined) => ["my-subscription", userId] as const,
  conciergeConversations: (userId: string | undefined) =>
    ["concierge-conversations", userId] as const,
  subscriptionPlans: ["subscription-plans"] as const,
  savedPalettes: (userId: string | undefined) => ["saved-palettes", userId] as const,
  similarItems: (postItemId: string, region: string | null = null) =>
    ["similar-items", postItemId, region] as const,
  profilePhotoUrl: (userId: string | undefined) => ["profile-photo-url", userId] as const,
  // Wave D. Separate roots from `profile`, so a missing Wave D column never
  // touches the main profile read.
  profileExtras: (userId: string | undefined) => ["profile-extras", userId] as const,
  checkInStatus: (userId: string | undefined) => ["check-in-status", userId] as const,
  analysisJob: (userId: string | undefined, kind: string) =>
    ["analysis-job", userId, kind] as const,
};
