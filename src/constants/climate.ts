export type ClimateIcon = "sun" | "cloud" | "rain" | "snow" | "wind";
export type ClimateCondition = "Sunny" | "Cloudy" | "Overcast" | "Rain" | "Snow" | "Windy";

export interface ClimateState {
  label: string;
  location: string;
  icon: ClimateIcon;
  tempF: number;
  tempC: number;
  condition: ClimateCondition;
}

export const DEFAULT_HUB_STORAGE_KEY = "mila.default-hub";

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
