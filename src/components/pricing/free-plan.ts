import { DEFAULT_AI_CREDITS } from "@/lib/credits";

/**
 * What an account without a plan gets, read from the code rather than written
 * as a sales sheet. Each line names where it comes from, so a change there is
 * a reason to change this:
 * - credits: `DEFAULT_AI_CREDITS` is the daily allowance with no live plan
 *   (`resolveDailyCreditAllowance`, `src/lib/credits.server.ts`);
 * - the first color read is the once-ever free founding read
 *   (`src/server/services/personal-color-analysis.ts`);
 * - the style dossier is built during onboarding, which every member completes
 *   before the app opens (`src/routes/_authenticated/_app.tsx`);
 * - the daily color mix is generated in the browser from her season, with no
 *   credit (`src/lib/color-analysis/paletteGenerator.ts`, on the dashboard);
 * - posting to and browsing the feed spend no credit (`createPostForUser`,
 *   `getFeedForUser` in `src/server/services/posts.ts`).
 */
export const FREE_PLAN = {
  title: "Free",
  description: "What every account gets.",
  dailyCredits: DEFAULT_AI_CREDITS,
  creditLine:
    DEFAULT_AI_CREDITS > 0
      ? `${DEFAULT_AI_CREDITS} styling credits per day`
      : "No daily styling credits. Looks come with a membership.",
  features: [
    "Your first color read from a selfie",
    "Your style dossier",
    "A daily color mix for your season",
    "Browse the feed and post your looks",
  ],
} as const;
