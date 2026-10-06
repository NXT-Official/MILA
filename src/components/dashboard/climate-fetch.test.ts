import { afterEach, describe, expect, test } from "bun:test";
import type { ClimateState } from "@/constants/climate";
import {
  climateOnFailedRead,
  fetchClimate,
  isUnavailableClimate,
  unavailableClimate,
} from "./climate-fetch";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

function jsonReply(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** Settles to what the promise did within `ms`, so a hang fails the test instead of wedging the runner. */
function outcomeWithin(promise: Promise<unknown>, ms: number) {
  return Promise.race([
    promise.then(
      () => "resolved" as const,
      () => "rejected" as const,
    ),
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), ms)),
  ]);
}

describe("fetchClimate", () => {
  test("turns a good reply into the member's weather", async () => {
    stubFetch(() =>
      jsonReply({ current: { temperature_2m: 18.4, weather_code: 61, wind_speed_10m: 10.2 } }),
    );
    expect(await fetchClimate(14.6, 120.98, "Manila", "PH")).toEqual({
      label: "18°C Light Rain",
      location: "Manila",
      country: "PH",
      icon: "rain",
      tempC: 18,
      tempF: 64,
      condition: "Rain",
    });
  });

  test("flags a windy day", async () => {
    stubFetch(() =>
      jsonReply({ current: { temperature_2m: 12, weather_code: 3, wind_speed_10m: 31 } }),
    );
    const climate = await fetchClimate(51.51, -0.13, "London", "GB");
    expect(climate.label).toBe("12°C Overcast & Windy");
    expect(climate.condition).toBe("Windy");
  });

  test("asks for the forecast of the requested place", async () => {
    let requested = "";
    stubFetch((url) => {
      requested = url;
      return jsonReply({ current: { temperature_2m: 20, weather_code: 0, wind_speed_10m: 0 } });
    });
    await fetchClimate(35.68, 139.69, "Tokyo", "JP");
    expect(requested).toContain("latitude=35.68");
    expect(requested).toContain("longitude=139.69");
  });

  test("an error reply is a failure, not made-up weather", async () => {
    stubFetch(() => jsonReply({ error: true, reason: "Too many requests" }, 429));
    await expect(fetchClimate(14.6, 120.98, "Manila", "PH")).rejects.toThrow();
  });

  test("a server error is a failure even when the body is not JSON", async () => {
    stubFetch(() => Promise.resolve(new Response("<html>Bad gateway</html>", { status: 502 })));
    await expect(fetchClimate(14.6, 120.98, "Manila", "PH")).rejects.toThrow();
  });

  test("a reply with no temperature is a failure, not 20 degrees", async () => {
    stubFetch(() => jsonReply({ current: {} }));
    await expect(fetchClimate(14.6, 120.98, "Manila", "PH")).rejects.toThrow();
    stubFetch(() => jsonReply({}));
    await expect(fetchClimate(14.6, 120.98, "Manila", "PH")).rejects.toThrow();
  });

  test("a missing weather code reads as mild, not partly cloudy", async () => {
    stubFetch(() => jsonReply({ current: { temperature_2m: 22 } }));
    const climate = await fetchClimate(14.6, 120.98, "Manila", "PH");
    expect(climate.label).toBe("22°C Mild");
  });

  test("gives up on a request that never answers", async () => {
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    expect(await outcomeWithin(fetchClimate(14.6, 120.98, "Manila", "PH", 50), 1000)).toBe(
      "rejected",
    );
  });

  test("gives up on a reply whose body never arrives", async () => {
    stubFetch(
      (_url, init) =>
        new Promise<Response>((resolve) => {
          const body = new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
            },
          });
          resolve(new Response(body, { status: 200 }));
        }),
    );
    expect(await outcomeWithin(fetchClimate(14.6, 120.98, "Manila", "PH", 50), 1000)).toBe(
      "rejected",
    );
  });
});

describe("unavailableClimate", () => {
  test("is an honest, neutral reading that keeps Create my look usable", () => {
    const climate = unavailableClimate("Tokyo", "JP");
    expect(climate.label).toBe("Weather unavailable — styling for mild conditions");
    expect(climate.location).toBe("Tokyo");
    expect(climate.country).toBe("JP");
    expect(climate.condition).toBe("Cloudy");
    expect(climate.tempC).toBe(20);
    expect(climate.tempF).toBe(68);
  });
});

describe("isUnavailableClimate", () => {
  test("recognises the fallback, wherever it was made for", () => {
    expect(isUnavailableClimate(unavailableClimate("Tokyo", "JP"))).toBe(true);
    expect(isUnavailableClimate(unavailableClimate("Your location", ""))).toBe(true);
  });

  test("never mistakes a real reading for it, even a 20°C cloudy one", () => {
    const real: ClimateState = {
      label: "20°C Partly Cloudy",
      location: "Manila",
      country: "PH",
      icon: "cloud",
      tempC: 20,
      tempF: 68,
      condition: "Cloudy",
    };
    expect(isUnavailableClimate(real)).toBe(false);
  });
});

describe("climateOnFailedRead", () => {
  const manila: ClimateState = {
    label: "31°C Clear Sky",
    location: "Manila",
    country: "PH",
    icon: "sun",
    tempC: 31,
    tempF: 88,
    condition: "Sunny",
  };

  test("with no weather yet, hands over the fallback so Create my look isn't left waiting", () => {
    expect(climateOnFailedRead(null, "Manila", "PH")).toEqual(unavailableClimate("Manila", "PH"));
  });

  test("with a reading already on screen, leaves it alone", () => {
    expect(climateOnFailedRead(manila, "Manila", "PH")).toBeNull();
  });
});
