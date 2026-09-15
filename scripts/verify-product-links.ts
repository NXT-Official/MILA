/**
 * Admin-run product link verification pass. Not exposed to users or run
 * automatically per-request — invoke manually (`bun run verify:products`)
 * or from an external, staff-controlled schedule.
 *
 * Fetches each product's affiliate_link through the SSRF-safe fetcher,
 * flags non-2xx responses and homepage/search/login-looking landing pages
 * as "broken" rather than trusting HTTP 200 alone, and records
 * verification_status + last_verified_at. Does not touch in_stock — stock
 * status isn't reliably inferable from a generic page fetch and should stay
 * an explicit admin/catalog decision.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { safeExternalFetch } from "@/lib/safe-external-fetch.server";

const HOMEPAGE_OR_AUTH_PATH_PATTERN = /^\/?(login|signin|sign-in|search|account)?\/?$/i;
const REQUEST_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyOne(affiliateLink: string): Promise<"verified" | "broken"> {
  try {
    const res = await safeExternalFetch(affiliateLink, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MilaLinkChecker/1.0)" },
    });
    if (!res.ok) return "broken";
    if (HOMEPAGE_OR_AUTH_PATH_PATTERN.test(new URL(res.url || affiliateLink).pathname)) {
      return "broken";
    }
    return "verified";
  } catch (err) {
    console.warn(`  ! ${affiliateLink} — ${err instanceof Error ? err.message : "unknown error"}`);
    return "broken";
  }
}

async function main() {
  const { data: products, error } = await supabaseAdmin
    .from("products")
    .select("id,title,affiliate_link");
  if (error) throw error;
  if (!products?.length) {
    console.log("No products to verify.");
    return;
  }

  let verified = 0;
  let broken = 0;
  for (const product of products) {
    const status = await verifyOne(product.affiliate_link);
    if (status === "verified") verified++;
    else broken++;
    console.log(`${status === "verified" ? "✓" : "✗"} ${product.title} (${product.id})`);

    const { error: updateError } = await supabaseAdmin
      .from("products")
      .update({ verification_status: status, last_verified_at: new Date().toISOString() })
      .eq("id", product.id);
    if (updateError) console.error(`  ! failed to record status for ${product.id}:`, updateError);

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\nDone. ${verified} verified, ${broken} broken, ${products.length} total.`);
}

main().catch((err) => {
  console.error("[verify-product-links] fatal:", err);
  process.exit(1);
});
