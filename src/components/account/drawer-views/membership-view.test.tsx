import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { MySubscription } from "@/lib/queries/subscriptions";
import { MembershipView } from "./membership-view";

const PLAN: MySubscription = {
  status: "active",
  current_period_end: "2026-12-01T00:00:00.000Z",
  cancel_at_period_end: false,
  plan_title: "Atelier Plus",
  credits_included: 30,
  price_amount: 499,
  currency: "PHP",
  billing_interval: "monthly",
  is_staff_granted: false,
};

type View = Parameters<typeof MembershipView>[0];

async function renderView(overrides: Partial<View>) {
  const props: View = {
    user: {
      fullName: "stylist_demo",
      username: "stylist_demo",
      season: null,
      faceShape: null,
      hairType: null,
    },
    authUserId: "user-1",
    subscription: null,
    credits: 0,
    onClose: () => {},
    resuming: false,
    onResume: () => {},
    onCancelClick: () => {},
    ...overrides,
  };
  const rootRoute = createRootRoute({ component: () => <MembershipView {...props} /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("MembershipView identity", () => {
  test("shows the handle it is given", async () => {
    const out = await renderView({});
    expect(out).toContain("@stylist_demo");
  });

  test("a member with no username gets no handle line, not '@null'", async () => {
    const out = await renderView({
      user: { fullName: "Member", username: null, season: null, faceShape: null, hairType: null },
    });
    expect(out).not.toContain("@");
    expect(out).not.toContain("null");
  });
});

describe("MembershipView concierge access", () => {
  test("a free member is not told they have Atelier access", async () => {
    const out = await renderView({ subscription: null, credits: 0 });
    expect(out).toContain("Free");
    expect(out).toContain("Members only");
    expect(out).not.toContain(">Atelier<");
  });

  test("a member on a plan sees access included alongside their plan name", async () => {
    const out = await renderView({ subscription: PLAN, credits: 12 });
    expect(out).toContain("Atelier Plus");
    expect(out).toContain("Included");
    expect(out).not.toContain("Members only");
  });

  test("a free member holding credits sees they are on credits", async () => {
    const out = await renderView({ subscription: null, credits: 4 });
    expect(out).toContain("On credits");
    expect(out).not.toContain("Members only");
  });
});
