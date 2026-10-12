import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { CaptureResult } from "posthog-js";
import { sanitizePosthogEvent, sanitizeUrl } from "./posthog-client";

// A PostHog event as the SDK hands it to `before_send`.
function event(
  properties: Record<string, unknown>,
  extra: Partial<Pick<CaptureResult, "$set" | "$set_once">> = {},
): CaptureResult {
  return { uuid: "0198-uuid", event: "$pageview", properties, ...extra };
}

describe("sanitizeUrl: auth credentials never reach analytics", () => {
  test("a callback URL carrying the session in the fragment keeps only origin and path", () => {
    const url =
      "https://mila.app/auth/callback#access_token=AT-secret&refresh_token=RT-secret&expires_in=3600&token_type=bearer&type=recovery";
    const clean = sanitizeUrl(url);
    expect(clean).toBe("https://mila.app/auth/callback");
    expect(clean).not.toContain("AT-secret");
    expect(clean).not.toContain("RT-secret");
  });

  test("any fragment is dropped, not just token-shaped ones", () => {
    expect(sanitizeUrl("https://mila.app/closet?tab=outfits#section-2")).toBe(
      "https://mila.app/closet?tab=outfits",
    );
  });

  test("the whole query and fragment are dropped on any /auth/* path, even allowlisted params", () => {
    expect(
      sanitizeUrl("https://mila.app/auth/callback?code=pkce-secret&utm_source=email#x=1"),
    ).toBe("https://mila.app/auth/callback");
    expect(sanitizeUrl("https://mila.app/auth/confirm?token_hash=th-secret&type=signup")).toBe(
      "https://mila.app/auth/confirm",
    );
    expect(sanitizeUrl("/auth/reset-password?tab=x")).toBe("/auth/reset-password");
    expect(sanitizeUrl("mila://auth/callback?code=S&utm_source=x#access_token=AT")).toBe(
      "mila://auth/callback",
    );
    expect(sanitizeUrl("mila://auth?code=S")).toBe("mila://auth");
  });

  test("a token in the path of /auth/confirm/<token> is replaced", () => {
    const token = "AbCdEf0123456789xyzQWERTY";
    const clean = sanitizeUrl(`https://mila.app/auth/confirm/${token}?x=1`);
    expect(clean).toBe("https://mila.app/auth/confirm/:token");
    expect(clean).not.toContain(token);
  });

  test("hex and JWT-shaped path segments are replaced; short ids are kept", () => {
    expect(sanitizeUrl("https://mila.app/r/0123456789abcdef0123/x")).toBe(
      "https://mila.app/r/:token/x",
    );
    expect(
      sanitizeUrl("https://mila.app/s/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc"),
    ).toBe("https://mila.app/s/:token");
    expect(sanitizeUrl("https://mila.app/look/8c1f")).toBe("https://mila.app/look/8c1f");
  });

  test("an encoded # inside the path cannot carry a fragment through", () => {
    expect(sanitizeUrl("https://mila.app/callback%23access_token=SECRET")).not.toContain("SECRET");
  });

  test("UTM and other allowlisted params are kept", () => {
    const url =
      "https://mila.app/closet?utm_source=email&utm_medium=cpc&utm_campaign=spring-sale&utm_term=boots&utm_content=a1&ref=friend&page=2&tab=outfits&section=top&view=grid&sort=new";
    expect(sanitizeUrl(url)).toBe(url);
  });

  test("anything outside the allowlist is dropped, including q and free text", () => {
    expect(sanitizeUrl("https://mila.app/search?q=nicole%40example.com&utm_source=x&look=1")).toBe(
      "https://mila.app/search?utm_source=x",
    );
    expect(sanitizeUrl("https://mila.app/x?SECRET")).toBe("https://mila.app/x");
  });

  test("otp, jwt, key and the old denylist params are all dropped", () => {
    expect(
      sanitizeUrl(
        "https://mila.app/x?otp=S1&jwt=S2&key=S3&code=S4&token_hash=S5&redirect=S6&tab=a",
      ),
    ).toBe("https://mila.app/x?tab=a");
  });

  test("names are matched case-insensitively", () => {
    expect(sanitizeUrl("https://mila.app/x?UTM_Source=e&CODE=b")).toBe(
      "https://mila.app/x?utm_source=e",
    );
  });

  test("double-encoded names cannot smuggle a key past the filter", () => {
    expect(sanitizeUrl("https://mila.app/x?%2563ode=SECRET&tab=a")).toBe(
      "https://mila.app/x?tab=a",
    );
    expect(sanitizeUrl("https://mila.app/x?%2574ab=a")).toBe("https://mila.app/x?tab=a");
  });

  test("a trailing space or + in the name does not hide or disguise a param", () => {
    for (const q of ["code%20=SECRET", "code+=SECRET", "%20code=SECRET", "code%2B=SECRET"]) {
      expect(sanitizeUrl(`https://mila.app/x?${q}&tab=a`)).toBe("https://mila.app/x?tab=a");
    }
  });

  test("; is a separator: a param after it is judged on its own", () => {
    expect(sanitizeUrl("https://mila.app/x?a=1;code=SECRET")).toBe("https://mila.app/x");
    expect(sanitizeUrl("https://mila.app/x?tab=a;code=SECRET")).toBe("https://mila.app/x?tab=a");
    expect(sanitizeUrl("https://mila.app/x?code=SECRET;tab=a")).toBe("https://mila.app/x?tab=a");
  });

  test("a token nested inside a kept param's value does not survive", () => {
    for (const q of [
      "ref=%2Fauth%3Fcode%3DSECRET",
      "tab=a%26code%3DSECRET",
      "ref=https%3A%2F%2Fx.test%2F%3Fcode%3DSECRET",
      "page=SECRET0123456789abcdefXYZ",
      "view=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
      "ref=%2525%2563ode%253DSECRET",
    ]) {
      const clean = sanitizeUrl(`https://mila.app/x?${q}&utm_source=ok`);
      expect(clean).not.toContain("SECRET");
      expect(clean).not.toContain("eyJ");
      expect(clean).toContain("utm_source=ok");
    }
  });

  test("embedded credentials (userinfo) are dropped", () => {
    expect(sanitizeUrl("https://user:pw@mila.app/x?code=1")).toBe("https://mila.app/x");
  });

  test("a custom-scheme deep link is sanitized the same way", () => {
    expect(sanitizeUrl("mila://auth/callback#access_token=AT&refresh_token=RT")).toBe(
      "mila://auth/callback",
    );
    expect(sanitizeUrl("mila://look/8c1f?utm_source=push&code=S")).toBe(
      "mila://look/8c1f?utm_source=push",
    );
  });

  test("a bare path (as in $pathname) is sanitized, not rejected", () => {
    expect(sanitizeUrl("/auth/callback?code=1#a=b")).toBe("/auth/callback");
    expect(sanitizeUrl("/closet")).toBe("/closet");
    expect(sanitizeUrl("/auth/confirm/AbCdEf0123456789xyzQWERTY")).toBe("/auth/confirm/:token");
  });

  test("unparseable input becomes a fixed placeholder, never the raw string", () => {
    expect(sanitizeUrl("not a url")).toBe("[unparseable-url]");
    expect(sanitizeUrl("")).toBe("[unparseable-url]");
    expect(sanitizeUrl("access_token=leaky")).toBe("[unparseable-url]");
    expect(sanitizeUrl("mailto:nicole@example.com")).toBe("[unparseable-url]");
  });

  test("sanitizing twice changes nothing", () => {
    for (const url of [
      "https://mila.app/auth/callback?code=1&keep=2#access_token=3",
      "https://mila.app/x?utm_source=a&code=1&tab=b",
    ]) {
      const once = sanitizeUrl(url);
      expect(sanitizeUrl(once)).toBe(once);
    }
  });
});

describe("sanitizePosthogEvent: the before_send hook scrubs every event", () => {
  const leaky = "https://mila.app/closet?code=pkce-secret&tab=outfits#access_token=AT-secret";
  const clean = "https://mila.app/closet?tab=outfits";

  test("sanitizes $current_url, $referrer, $pathname, $initial_current_url and $initial_referrer", () => {
    const result = sanitizePosthogEvent(
      event({
        $current_url: leaky,
        $referrer: "https://mila.app/login?redirect=%2Fcloset&token_hash=th-secret",
        $pathname: "/closet#access_token=AT-secret",
        $initial_current_url: leaky,
        $initial_referrer: "https://accounts.example/?code=abc",
      }),
    );
    expect(result?.properties).toEqual({
      $current_url: clean,
      $referrer: "https://mila.app/login",
      $pathname: "/closet",
      $initial_current_url: clean,
      $initial_referrer: "https://accounts.example/",
    });
  });

  test("sanitizes the person properties PostHog attaches at the top level of the event", () => {
    const result = sanitizePosthogEvent(
      event(
        { $current_url: leaky },
        {
          $set_once: { $initial_current_url: leaky, $initial_referrer: leaky },
          $set: { $current_url: leaky },
        },
      ),
    );
    expect(result?.$set_once).toEqual({ $initial_current_url: clean, $initial_referrer: clean });
    expect(result?.$set).toEqual({ $current_url: clean });
  });

  test("sanitizes person properties nested under properties.$set and properties.$set_once", () => {
    const result = sanitizePosthogEvent(
      event({ $set: { $current_url: leaky }, $set_once: { $initial_current_url: leaky } }),
    );
    expect(result?.properties.$set).toEqual({ $current_url: clean });
    expect(result?.properties.$set_once).toEqual({ $initial_current_url: clean });
  });

  test("sanitizes the session-entry and external-click URLs the SDK derives", () => {
    const result = sanitizePosthogEvent(
      event({
        $session_entry_url: leaky,
        $session_entry_referrer: leaky,
        $session_entry_pathname: "/auth/callback?code=1",
        $external_click_url: leaky,
      }),
    );
    expect(result?.properties).toEqual({
      $session_entry_url: clean,
      $session_entry_referrer: clean,
      $session_entry_pathname: "/auth/callback",
      $external_click_url: clean,
    });
  });

  test("scrubs autocaptured link hrefs in $elements_chain and $elements", () => {
    const result = sanitizePosthogEvent(
      event({
        $elements_chain:
          'a.btn:attr__href="/login?redirect=%2Fcloset"href="/login?redirect=%2Fcloset"nth-child="1";div:nth-child="2"',
        $elements: [{ tag_name: "a", attr__href: "/auth/callback?code=1", $el_text: "Sign in" }],
      }),
    );
    const chain = String(result?.properties.$elements_chain);
    expect(chain).not.toContain("redirect");
    expect(chain).toContain('href="/login"');
    expect(chain).toContain('div:nth-child="2"');
    expect(result?.properties.$elements).toEqual([
      { tag_name: "a", attr__href: "/auth/callback", $el_text: "Sign in" },
    ]);
  });

  test("PostHog's $direct referrer sentinel is not a URL and passes through", () => {
    const result = sanitizePosthogEvent(
      event({ $referrer: "$direct", $initial_referrer: "$direct" }),
    );
    expect(result?.properties).toEqual({ $referrer: "$direct", $initial_referrer: "$direct" });
  });

  test("everything else on the event is untouched", () => {
    const timestamp = new Date("2026-10-07T00:00:00Z");
    const input: CaptureResult = {
      uuid: "u-1",
      event: "look_generated",
      timestamp,
      properties: {
        app: "mila-web",
        count: 3,
        flag: true,
        $current_url: undefined,
        note: "see https://x.example/?code=1 inline",
        $unrelated_url: leaky,
      },
    };
    const result = sanitizePosthogEvent(input);
    expect(result?.uuid).toBe("u-1");
    expect(result?.event).toBe("look_generated");
    expect(result?.timestamp).toBe(timestamp);
    expect(result?.properties.app).toBe("mila-web");
    expect(result?.properties.count).toBe(3);
    expect(result?.properties.flag).toBe(true);
    expect(result?.properties.note).toBe("see https://x.example/?code=1 inline");
    expect(result?.properties.$unrelated_url).toBe(leaky);
    expect(result?.properties.$current_url).toBeUndefined();
  });

  test("does not mutate the event it was given", () => {
    const input = event({ $current_url: leaky }, { $set_once: { $initial_current_url: leaky } });
    sanitizePosthogEvent(input);
    expect(input.properties.$current_url).toBe(leaky);
    expect(input.$set_once?.$initial_current_url).toBe(leaky);
  });

  test("a null event stays null", () => {
    expect(sanitizePosthogEvent(null)).toBeNull();
  });

  test("fails closed: an event it cannot read is dropped, not sent", () => {
    const hostile: CaptureResult = {
      uuid: "u-2",
      event: "$pageview",
      get properties(): CaptureResult["properties"] {
        throw new Error("boom");
      },
    };
    expect(sanitizePosthogEvent(hostile)).toBeNull();
  });
});

describe("posthog.init is wired with the hook and fragment stripping", () => {
  type Config = {
    before_send?: (cr: CaptureResult | null) => CaptureResult | null;
    disable_capture_url_hashes?: boolean;
    capture_pageview?: boolean;
    advanced_disable_flags?: boolean;
    disable_session_recording?: boolean;
    capture_heatmaps?: boolean;
    capture_dead_clicks?: boolean;
  };
  const init = mock((_key: string, _config: Config) => {});
  const capture = mock((_event: string, _properties?: Record<string, unknown>) => {});
  const fakePosthog = {
    default: {
      init,
      capture,
      register: mock(() => {}),
      identify: mock(() => {}),
      reset: mock(() => {}),
    },
  };
  const g = globalThis as { window?: unknown };
  let priorWindow: unknown;
  let priorKey: string | undefined;
  let realPosthog: Record<string, unknown>;
  let wired: typeof import("./posthog-client");

  beforeAll(async () => {
    realPosthog = await import("posthog-js");
    priorWindow = g.window;
    priorKey = process.env.VITE_POSTHOG_KEY;
    process.env.VITE_POSTHOG_KEY = "phc_test_key";
    g.window = {};
    mock.module("posthog-js", () => fakePosthog);
    // A query string gives this evaluation its own module instance, so the
    // keyless instance other suites import is not disturbed.
    const specifier = "./posthog-client.ts?wired";
    wired = (await import(specifier)) as typeof import("./posthog-client");
  });

  afterAll(() => {
    mock.module("posthog-js", () => realPosthog);
    if (priorWindow === undefined) delete g.window;
    else g.window = priorWindow;
    if (priorKey === undefined) delete process.env.VITE_POSTHOG_KEY;
    else process.env.VITE_POSTHOG_KEY = priorKey;
  });

  test("init receives a before_send hook that sanitizes an event", () => {
    expect(init).toHaveBeenCalledTimes(1);
    const config = init.mock.calls[0]?.[1] as Config;
    expect(typeof config.before_send).toBe("function");
    const result = config.before_send?.(
      event({ $current_url: "https://mila.app/auth/callback#access_token=AT-secret" }),
    );
    expect(result?.properties.$current_url).toBe("https://mila.app/auth/callback");
  });

  test("init also asks the SDK itself to strip URL hashes", () => {
    const config = init.mock.calls[0]?.[1] as Config;
    expect(config.disable_capture_url_hashes).toBe(true);
    expect(config.capture_pageview).toBe(false);
  });

  test("no /flags request can leak the landing URL: flags are disabled", () => {
    // The flags request carries person_properties.$initial_current_url and
    // never passes through before_send, so the only safe fix is no request.
    const config = init.mock.calls[0]?.[1] as Config;
    expect(config.advanced_disable_flags).toBe(true);
  });

  test("session replay, heatmaps and dead clicks are off (their payloads are not scrubbed)", () => {
    const config = init.mock.calls[0]?.[1] as Config;
    expect(config.disable_session_recording).toBe(true);
    expect(config.capture_heatmaps).toBe(false);
    expect(config.capture_dead_clicks).toBe(false);
  });

  test("capturePageview sends a sanitized $current_url", () => {
    wired.capturePageview(
      "https://mila.app/closet?code=pkce-secret&tab=outfits#access_token=AT-secret&refresh_token=RT-secret",
    );
    expect(capture).toHaveBeenCalledWith("$pageview", {
      $current_url: "https://mila.app/closet?tab=outfits",
    });
  });
});
