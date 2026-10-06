import { climateForWeatherCode, type ClimateState } from "@/constants/climate";

/** How long the forecast lookup may take before we stop waiting. */
export const CLIMATE_FETCH_TIMEOUT_MS = 8000;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads today's weather for a place. Rejects — never invents a reading — when
 * the forecast service errors, answers without a temperature, or doesn't answer
 * within `timeoutMs`.
 */
export async function fetchClimate(
  lat: number,
  lon: number,
  location: string,
  country: string,
  timeoutMs: number = CLIMATE_FETCH_TIMEOUT_MS,
): Promise<ClimateState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`,
      { signal: controller.signal },
    );
    if (!r.ok) throw new Error("Weather lookup failed");
    const j: { current?: Record<string, unknown> } | null = await r.json();
    const rawTemp = finiteNumber(j?.current?.temperature_2m);
    if (rawTemp === null) throw new Error("Weather lookup returned no temperature");
    const temp = Math.round(rawTemp);
    const wind = Math.round(finiteNumber(j?.current?.wind_speed_10m) ?? 0);
    const weather = climateForWeatherCode(
      finiteNumber(j?.current?.weather_code) ?? Number.NaN,
      wind,
    );
    const windy = wind >= 25 ? " & Windy" : "";
    return {
      label: `${temp}°C ${weather.description}${windy}`,
      location,
      country,
      icon: weather.icon,
      tempC: temp,
      tempF: Math.round((temp * 9) / 5 + 32),
      condition: weather.condition,
    };
  } finally {
    clearTimeout(timer);
  }
}

const UNAVAILABLE_CLIMATE_LABEL = "Weather unavailable — styling for mild conditions";

/**
 * Stand-in for a weather read that failed. The label says so plainly; the
 * numbers are a neutral, mild day so Create my look still works.
 */
export function unavailableClimate(location: string, country: string): ClimateState {
  return {
    label: UNAVAILABLE_CLIMATE_LABEL,
    location,
    country,
    icon: "cloud",
    tempC: 20,
    tempF: 68,
    condition: "Cloudy",
  };
}

/** True for the stand-in above, so the screen never presents its numbers as a real reading. */
export function isUnavailableClimate(climate: ClimateState): boolean {
  return climate.label === UNAVAILABLE_CLIMATE_LABEL;
}

/**
 * What to hand the dashboard when a weather read fails: nothing when it already
 * has a reading (an earlier real one beats a placeholder), otherwise the
 * stand-in, so Create my look is never left waiting on a forecast that isn't
 * coming.
 */
export function climateOnFailedRead(
  current: ClimateState | null,
  location: string,
  country: string,
): ClimateState | null {
  return current ? null : unavailableClimate(location, country);
}
