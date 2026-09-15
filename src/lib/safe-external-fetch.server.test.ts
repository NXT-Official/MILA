import { describe, expect, test } from "bun:test";
import { safeExternalFetch, type DnsLookup } from "./safe-external-fetch.server";

const publicDns: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const privateDns: DnsLookup = async () => [{ address: "10.0.0.5", family: 4 }];

describe("safeExternalFetch", () => {
  test("rejects non-http(s) schemes", async () => {
    await expect(
      safeExternalFetch("ftp://example.com/file", undefined, { dnsLookup: publicDns }),
    ).rejects.toThrow("Only http(s) URLs are allowed");
  });

  test("rejects an IPv4-literal private address directly in the URL", async () => {
    await expect(
      safeExternalFetch("http://10.0.0.1/admin", undefined, { dnsLookup: publicDns }),
    ).rejects.toThrow("Refusing to fetch a private address");
  });

  test("rejects a hostname that resolves to a private address", async () => {
    await expect(
      safeExternalFetch("https://internal.example.com/", undefined, { dnsLookup: privateDns }),
    ).rejects.toThrow("Refusing to fetch a private or internal address");
  });

  test("rejects loopback", async () => {
    await expect(
      safeExternalFetch("http://127.0.0.1/", undefined, { dnsLookup: publicDns }),
    ).rejects.toThrow("Refusing to fetch a private address");
  });

  test("fetches a public address and re-validates each redirect hop", async () => {
    let calls = 0;
    const fetchImpl = (async (url: string | URL) => {
      calls++;
      if (String(url) === "https://retailer.example.com/product/1") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/final" },
        });
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const res = await safeExternalFetch("https://retailer.example.com/product/1", undefined, {
      dnsLookup: publicDns,
      fetchImpl,
    });
    expect(await res.text()).toBe("ok");
    expect(calls).toBe(2);
  });

  test("rejects a redirect chain that exceeds the hop limit", async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://retailer.example.com/next" },
      })) as typeof fetch;

    await expect(
      safeExternalFetch(
        "https://retailer.example.com/start",
        { maxRedirects: 1 },
        { dnsLookup: publicDns, fetchImpl },
      ),
    ).rejects.toThrow("Too many redirects");
  });

  test("rejects a redirect that points at a private address", async () => {
    let hop = 0;
    const fetchImpl = (async () => {
      hop++;
      if (hop === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
      }
      return new Response("should not reach here", { status: 200 });
    }) as typeof fetch;

    await expect(
      safeExternalFetch("https://retailer.example.com/start", undefined, {
        dnsLookup: publicDns,
        fetchImpl,
      }),
    ).rejects.toThrow("Refusing to fetch a private address");
  });
});
