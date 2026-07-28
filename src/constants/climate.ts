export type ClimateIcon = "sun" | "cloud" | "rain" | "snow" | "wind";
export type ClimateCondition = "Sunny" | "Cloudy" | "Overcast" | "Rain" | "Snow" | "Windy";

interface ClimateWeather {
  icon: ClimateIcon;
  condition: ClimateCondition;
  description: string;
}

const WEATHER_BY_CODE: Record<number, ClimateWeather> = {
  0: { icon: "sun", condition: "Sunny", description: "Clear sky" },
  1: { icon: "sun", condition: "Sunny", description: "Mainly clear" },
  2: { icon: "cloud", condition: "Cloudy", description: "Partly cloudy" },
  3: { icon: "cloud", condition: "Overcast", description: "Overcast" },
  45: { icon: "cloud", condition: "Overcast", description: "Fog" },
  48: { icon: "cloud", condition: "Overcast", description: "Rime fog" },
  51: { icon: "rain", condition: "Rain", description: "Light drizzle" },
  53: { icon: "rain", condition: "Rain", description: "Moderate drizzle" },
  55: { icon: "rain", condition: "Rain", description: "Dense drizzle" },
  56: { icon: "rain", condition: "Rain", description: "Light freezing drizzle" },
  57: { icon: "rain", condition: "Rain", description: "Dense freezing drizzle" },
  61: { icon: "rain", condition: "Rain", description: "Light rain" },
  63: { icon: "rain", condition: "Rain", description: "Moderate rain" },
  65: { icon: "rain", condition: "Rain", description: "Heavy rain" },
  66: { icon: "rain", condition: "Rain", description: "Light freezing rain" },
  67: { icon: "rain", condition: "Rain", description: "Heavy freezing rain" },
  71: { icon: "snow", condition: "Snow", description: "Light snowfall" },
  73: { icon: "snow", condition: "Snow", description: "Moderate snowfall" },
  75: { icon: "snow", condition: "Snow", description: "Heavy snowfall" },
  77: { icon: "snow", condition: "Snow", description: "Snow grains" },
  80: { icon: "rain", condition: "Rain", description: "Light rain showers" },
  81: { icon: "rain", condition: "Rain", description: "Moderate rain showers" },
  82: { icon: "rain", condition: "Rain", description: "Heavy rain showers" },
  85: { icon: "snow", condition: "Snow", description: "Light snow showers" },
  86: { icon: "snow", condition: "Snow", description: "Heavy snow showers" },
  95: { icon: "rain", condition: "Rain", description: "Thunderstorm" },
  96: { icon: "rain", condition: "Rain", description: "Thunderstorm with light hail" },
  99: { icon: "rain", condition: "Rain", description: "Thunderstorm with heavy hail" },
};

const UNKNOWN_WEATHER: ClimateWeather = {
  icon: "cloud",
  condition: "Cloudy",
  description: "Mild",
};

export function climateForWeatherCode(code: number, windKph = 0): ClimateWeather {
  const weather = WEATHER_BY_CODE[code] ?? UNKNOWN_WEATHER;
  return windKph >= 25 && weather.icon === "cloud"
    ? { ...weather, icon: "wind", condition: "Windy" }
    : weather;
}

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
