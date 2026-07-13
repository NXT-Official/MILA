export type ClimateIcon = "sun" | "cloud" | "rain" | "snow" | "wind";
export type ClimateCondition = "Sunny" | "Cloudy" | "Overcast" | "Rain" | "Snow" | "Windy";

// Resolved live weather (from Open-Meteo). Never hardcoded/fallback data.
export interface ClimateState {
  label: string;
  location: string;
  icon: ClimateIcon;
  tempF: number;
  tempC: number;
  condition: ClimateCondition;
}

// profiles.default_location stores only a hub id (see src/lib/default-hub.ts).
// Kept as a deliberate local-only cache for pre-auth render + offline; also
// doubles as the one-time migration source the first time a user signs in.
export const DEFAULT_HUB_STORAGE_KEY = "mila.default-hub";

// Location registry only — resolves a saved hub id to city/lat/lon so live
// weather can be fetched from Open-Meteo. No hardcoded climate data here.
export const HUBS: Array<{
  id: string;
  city: string;
  tagline: string;
  lat: number;
  lon: number;
}> = [
  { id: "manila", city: "Manila", tagline: "Tropical Humid", lat: 14.6, lon: 120.98 },
  { id: "singapore", city: "Singapore", tagline: "Equatorial Humid", lat: 1.35, lon: 103.82 },
  { id: "dubai", city: "Dubai", tagline: "Arid Heat", lat: 25.2, lon: 55.27 },
  { id: "la", city: "Los Angeles", tagline: "Warm & Dry", lat: 34.05, lon: -118.24 },
  { id: "seoul", city: "Seoul", tagline: "Crisp Spring", lat: 37.57, lon: 126.98 },
  { id: "tokyo", city: "Tokyo", tagline: "Mild Overcast", lat: 35.68, lon: 139.69 },
  { id: "paris", city: "Paris", tagline: "Cool Drizzle", lat: 48.86, lon: 2.35 },
  { id: "london", city: "London", tagline: "Overcast Chill", lat: 51.51, lon: -0.13 },
  { id: "nyc", city: "New York", tagline: "Brisk Autumn", lat: 40.71, lon: -74.01 },
  { id: "stockholm", city: "Stockholm", tagline: "Frost & Snow", lat: 59.33, lon: 18.07 },
];
