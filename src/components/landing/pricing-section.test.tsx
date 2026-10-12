import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthContext } from "@/hooks/use-auth";
import type { PricingContent } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { DEFAULT_AI_CREDITS } from "@/lib/credits";
import { publicSubscriptionPlansQueryOptions } from "@/lib/queries/subscription-plans";
import type { PublicSubscriptionPlan } from "@/lib/subscription-plans";
import { FREE_PLAN } from "@/components/pricing/free-plan";
import { SHOW_CREDIT_PACKS } from "@/components/pricing/credit-packs";
import { PricingSection } from "./pricing-section";

/** The cache entry the section reads; the same key the app's query writes. */
const PLANS_KEY = publicSubscriptionPlansQueryOptions().queryKey;

/** Copy as it appears in the markup: React escapes quotes, ampersands and angle brackets. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

/** The section `<h2>` and the per-plan `<h3>`s, in document order. */
function headings(markup: string) {
  return {
    h2: [...markup.matchAll(/<h2[^>]*>(.*?)<\/h2>/gs)].map(([, inner]) => inner),
    h3: [...markup.matchAll(/<h3[^>]*>(.*?)<\/h3>/gs)].map(([, inner]) => inner),
  };
}

/** Everything in the markup that reads as a price, in document order. */
function prices(markup: string): string[] {
  return markup.match(/[$£€₱]\d[\d.,]*/g) ?? [];
}

function count(markup: string, needle: string) {
  return markup.split(needle).length - 1;
}

/** How one loading placeholder opens in the markup, taken from the real Skeleton. */
const PLACEHOLDER = renderToStaticMarkup(<Skeleton />).replace(/"><\/div>$/, "");

/** A query client whose plans query has already resolved with `plans`. */
function clientWith(plans: PublicSubscriptionPlan[]) {
  const client = new QueryClient();
  client.setQueryData(PLANS_KEY, plans);
  return client;
}

/** The section needs a router (useNavigate, Link), a query client and the auth context. */
async function renderPricing(client: QueryClient, content: PricingContent) {
  const rootRoute = createRootRoute({
    component: () => (
      <AuthContext.Provider
        value={{
          user: null,
          session: null,
          loading: false,
          signingOut: false,
          signOut: async () => {},
        }}
      >
        <QueryClientProvider client={client}>
          <PricingSection content={content} />
        </QueryClientProvider>
      </AuthContext.Provider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

/** Two plans as the Supabase query returns them. */
const PLANS: PublicSubscriptionPlan[] = [
  {
    id: "plan-a",
    slug: "test-muse",
    title: "Test Plan Muse",
    description: "First test plan",
    price_amount: 900,
    currency: "usd",
    billing_interval: "monthly",
    credits_included: 5,
    features: ["First test feature"],
    is_featured: false,
    paddle_price_id: "pri_test_a",
  },
  {
    id: "plan-b",
    slug: "test-atelier",
    title: "Test Plan Atelier",
    description: "Second test plan",
    price_amount: 2400,
    currency: "usd",
    billing_interval: "yearly",
    credits_included: 20,
    features: ["Second test feature"],
    is_featured: true,
    paddle_price_id: "pri_test_b",
  },
];
/** What a visitor is shown for each plan: its price, then its monthly equivalent when yearly. */
const SHOWN = { "plan-a": ["$9.00"], "plan-b": ["$24.00", "$2.00"] } as Record<string, string[]>;
/** The Free column leads, priced at zero in the plans' currency. */
const FREE_PRICE = "$0.00";

function shownPrices(plans: PublicSubscriptionPlan[]) {
  return [FREE_PRICE, ...plans.flatMap((plan) => SHOWN[plan.id])];
}

/** The two fields the Studio edits, set to copy the fallback does not contain. */
const EDITED: PricingContent = {
  ...LANDING_FALLBACK.pricing,
  heading: "Edited pricing heading",
  body: "Edited pricing body: it's clear & simple.",
};

describe("PricingSection copy comes from content", () => {
  test("heading and body", async () => {
    const out = await renderPricing(clientWith(PLANS), EDITED);
    expect(out).toContain(`>${text(EDITED.heading)}</h2>`);
    expect(out).toContain(`>${text(EDITED.body)}<`);
  });
});

describe("PricingSection plans come only from the plans query", () => {
  test("plan names and prices are the query's, in the query's order, after the Free column", async () => {
    const out = await renderPricing(clientWith(PLANS), EDITED);
    const { h2, h3 } = headings(out);
    expect(h2).toEqual([text(EDITED.heading)]);
    expect(h3).toEqual([FREE_PLAN.title, ...PLANS.map((plan) => text(plan.title))]);
    expect(prices(out)).toEqual(shownPrices(PLANS));
    expect(count(out, PLACEHOLDER)).toBe(0);

    const reversedPlans = [...PLANS].reverse();
    const reversed = await renderPricing(clientWith(reversedPlans), EDITED);
    const reversedHeadings = headings(reversed);
    expect(reversedHeadings.h2).toEqual([text(EDITED.heading)]);
    expect(reversedHeadings.h3).toEqual([
      FREE_PLAN.title,
      ...reversedPlans.map((plan) => text(plan.title)),
    ]);
    expect(prices(reversed)).toEqual(shownPrices(reversedPlans));
  });

  test("price- and plan-looking values smuggled into content change nothing", async () => {
    /** Fields the Studio schema does not have, as a tampered document might carry them. */
    const smuggled = {
      ...EDITED,
      price: "$1",
      title: "Smuggled Plan",
      plans: [{ ...PLANS[0], id: "smuggled", title: "Smuggled Plan", price_amount: 100 }],
      href: "https://evil.example/checkout",
    } as PricingContent;
    const out = await renderPricing(clientWith(PLANS), smuggled);
    // Guard: the smuggled object is what was rendered.
    expect(out).toContain(`>${text(smuggled.heading)}</h2>`);

    expect(out).not.toContain("$1");
    expect(out).not.toContain("Smuggled");
    expect(out).not.toContain("evil.example");
    expect(out).toBe(await renderPricing(clientWith(PLANS), EDITED));
  });
});

describe("PricingSection without plans", () => {
  test("before the query has data: heading and body over three placeholders, no plan or price", async () => {
    const out = await renderPricing(new QueryClient(), EDITED);
    expect(headings(out).h2).toEqual([text(EDITED.heading)]);
    expect(out).toContain(`>${text(EDITED.body)}<`);
    expect(count(out, PLACEHOLDER)).toBe(3);
    // The placeholders say what they are waiting for.
    expect(out).toMatch(/<div[^>]*role="status"[^>]*>(?:(?!<\/div>).)*Loading plans/s);
    expect(prices(out)).toEqual([]);
    expect(out).not.toContain("<li");
    expect(out).not.toContain("<button");
  });

  test("the query returned no plans: heading, body and a preparing state stand in for the plans", async () => {
    const out = await renderPricing(clientWith([]), EDITED);
    expect(out).toContain(`>${text(EDITED.heading)}</h2>`);
    expect(out).toContain(`>${text(EDITED.body)}<`);
    expect(out).toContain("Membership plans are being prepared.");
    expect(out).toContain("Please check back soon.");
    expect(prices(out)).toEqual([]);
    expect(count(out, PLACEHOLDER)).toBe(0);
    expect(out).not.toContain("<li");
  });

  test("the query failed: heading, body and a retry panel stand in for the plans", async () => {
    // `retryOnMount: false` keeps the failed result for the first render. With
    // the default, a newly mounted section shows the placeholders while it retries.
    const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
    await client.prefetchQuery({
      queryKey: PLANS_KEY,
      queryFn: async (): Promise<PublicSubscriptionPlan[]> => {
        throw new Error("plans unavailable");
      },
      retry: false,
    });
    // Guard: the query really is in its failed state.
    expect(client.getQueryState(PLANS_KEY)?.status).toBe("error");

    const out = await renderPricing(client, EDITED);
    expect(out).toContain(`>${text(EDITED.heading)}</h2>`);
    expect(out).toContain(`>${text("Couldn't load membership plans")}</p>`);
    expect(out).toContain("Try Again");
    expect(prices(out)).toEqual([]);
  });
});

describe("PricingSection lets a visitor judge the plans", () => {
  test("a Free column says what every account gets, from the code, not a sales sheet", async () => {
    // Guard: the column's credits are the ones a member without a plan really gets.
    expect(FREE_PLAN.dailyCredits).toBe(DEFAULT_AI_CREDITS);

    const out = await renderPricing(clientWith(PLANS), EDITED);
    const free = out.slice(
      out.indexOf(`>${FREE_PLAN.title}</h3>`),
      out.indexOf(`>${text(PLANS[0].title)}</h3>`),
    );
    expect(free).toContain(FREE_PRICE);
    expect(free).toContain(text(FREE_PLAN.creditLine));
    for (const feature of FREE_PLAN.features) expect(free).toContain(`>${text(feature)}<`);
    // Free has nothing to check out.
    expect(free).not.toContain("<button");
  });

  test("no card offers credit packs while none are on sale", async () => {
    // A code flag, never plan data: a one-time plan has no fulfilment yet.
    expect(SHOW_CREDIT_PACKS).toBe(false);
    const out = await renderPricing(clientWith(PLANS), EDITED);
    // Guard: the plan cards rendered their feature lists.
    expect(out).toContain("First test feature");
    expect(out).not.toMatch(/credit pack|top up/i);
  });

  test("with three plans the four columns wait for xl; below that they sit two by two", async () => {
    const third = { ...PLANS[0], id: "plan-c", slug: "test-c", title: "Test Plan C" };
    const out = await renderPricing(clientWith([...PLANS, third]), EDITED);
    const list = out.match(/<ul\b[^>]*class="([^"]*)"/)?.[1] ?? "";
    // Guard: this is the plans list (Free plus three plans).
    expect(headings(out).h3).toHaveLength(4);
    expect(list).toContain("sm:grid-cols-2");
    expect(list).toContain("xl:grid-cols-4");
    expect(list).not.toMatch(/(^|\s)(md|lg):grid-cols-/);
  });

  test("a credit is defined as a look", async () => {
    const out = await renderPricing(clientWith(PLANS), EDITED);
    expect(out).toContain("1 credit = 1 look");
  });

  test("a yearly plan shows what it costs a month", async () => {
    const out = await renderPricing(clientWith(PLANS), EDITED);
    expect(out).toContain("$2.00 a month, billed yearly");
    // A monthly plan has nothing to convert.
    expect(out).not.toContain("$9.00 a month");
  });

  test("the featured plan is recommended only when it is the best value, and the card says why", async () => {
    // Plan B is featured and gives 600 looks for $2.00 a month; plan A gives 150 for $9.00.
    const out = await renderPricing(clientWith(PLANS), EDITED);
    expect(count(out, ">Recommended<")).toBe(1);
    expect(out).toContain("Best value: the most looks for the price.");
    expect(out).toContain(`aria-label="${text(PLANS[1].title)}, recommended"`);
  });

  test("when the numbers beat the featured plan, the badge drops the claim and the better plan says so", async () => {
    const plans = [
      { ...PLANS[0], is_featured: true },
      { ...PLANS[1], is_featured: false },
    ];
    const out = await renderPricing(clientWith(plans), EDITED);
    expect(out).not.toContain("Recommended");
    expect(count(out, ">Featured<")).toBe(1);
    expect(count(out, ">Best value<")).toBe(1);
    expect(out).toContain("The most looks for the price.");
  });
});

describe("PricingSection after the plans request ends in error (MW-12)", () => {
  /** A client whose plans query has used up its retries on an aborted request. */
  async function clientAfterRetries(attempts: { count: number }) {
    const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
    await client.prefetchQuery({
      queryKey: PLANS_KEY,
      queryFn: async (): Promise<PublicSubscriptionPlan[]> => {
        attempts.count += 1;
        throw new DOMException("The operation was aborted.", "AbortError");
      },
      retry: 2,
      retryDelay: 1,
    });
    return client;
  }

  test("the retries run out and the section still says so and offers a retry", async () => {
    const attempts = { count: 0 };
    const client = await clientAfterRetries(attempts);
    // Guard: the request was tried again before giving up, and the query ended in error.
    expect(attempts.count).toBe(3);
    expect(client.getQueryState(PLANS_KEY)?.status).toBe("error");

    const out = await renderPricing(client, EDITED);
    expect(out).toContain(`>${text(EDITED.heading)}</h2>`);
    expect(out).toContain(`>${text("Couldn't load membership plans")}</p>`);
    expect(out).toContain('role="alert"');
    expect(out).toContain("Try Again");
    expect(count(out, PLACEHOLDER)).toBe(0);
    expect(prices(out)).toEqual([]);
  });

  test("while it is still retrying the section shows placeholders, not a blank", async () => {
    const client = new QueryClient();
    void client.prefetchQuery({
      queryKey: PLANS_KEY,
      queryFn: () => new Promise<PublicSubscriptionPlan[]>(() => {}),
    });
    expect(client.getQueryState(PLANS_KEY)?.fetchStatus).toBe("fetching");

    const out = await renderPricing(client, EDITED);
    expect(count(out, PLACEHOLDER)).toBe(3);
  });
});

describe("PricingSection gives up on a failing plans request in bounded time (MW-12)", () => {
  test("it adds no retries of its own on top of the Supabase client's", async () => {
    // Each plans request is already retried with backoff (~7s) inside the Supabase
    // client. Stacking react-query's default three retries on top kept a visitor
    // on the placeholders for ~35s before the retry panel appeared (measured on
    // the live site with the request aborted), longer than a crawler or an
    // impatient member waits.
    const client = new QueryClient();
    await renderPricing(client, EDITED);

    const query = client.getQueryCache().find({ queryKey: PLANS_KEY });
    expect(query).toBeDefined();
    expect(query?.options.retry).toBe(false);
  });
});
