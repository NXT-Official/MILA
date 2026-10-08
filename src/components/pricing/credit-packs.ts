/**
 * Credit packs are not on sale. Paddle sync drops any transaction without a
 * subscription (`src/lib/paddle-sync.server.ts`: memberships are the only
 * thing sold), and purchased credits only arrive through refunds and the
 * admin's "Add styling credits". Until a pack can be bought and fulfilled, no
 * pricing card offers one.
 *
 * A code flag on purpose, never derived from plan data: a one-time plan
 * created in the admin has no fulfilment behind it, so its existence must not
 * switch the offer on.
 */
export const SHOW_CREDIT_PACKS = false;
