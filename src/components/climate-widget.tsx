import { useEffect, useState } from "react";
import { Sun, Cloud, CloudRain, CloudSnow, Wind, MapPin, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ClimateIcon = "sun" | "cloud" | "rain" | "snow" | "wind";
export type ClimateCondition = "Sunny" | "Cloudy" | "Overcast" | "Rain" | "Snow" | "Windy";

export interface ClimateState {
  label: string; // e.g. "32°C Humid Afternoon" — passed to AI
  location: string; // e.g. "Manila"
  icon: ClimateIcon;
  tempF: number; // Fahrenheit, rounded
  tempC: number; // Celsius, rounded
  condition: ClimateCondition;
}

const HUBS: Array<{ id: string; city: string; tagline: string; climate: ClimateState }> = [
  {
    id: "manila",
    city: "Manila",
    tagline: "Tropical Humid",
    climate: { label: "32°C Humid Afternoon, tropical sun", location: "Manila", icon: "sun", tempC: 32, tempF: 90, condition: "Sunny" },
  },
  {
    id: "singapore",
    city: "Singapore",
    tagline: "Equatorial Humid",
    climate: { label: "31°C Hot & Humid, equatorial", location: "Singapore", icon: "sun", tempC: 31, tempF: 88, condition: "Sunny" },
  },
  {
    id: "dubai",
    city: "Dubai",
    tagline: "Arid Heat",
    climate: { label: "38°C Arid Dry Heat, desert sun", location: "Dubai", icon: "sun", tempC: 38, tempF: 100, condition: "Sunny" },
  },
  {
    id: "la",
    city: "Los Angeles",
    tagline: "Warm & Dry",
    climate: { label: "26°C Warm & Dry, light breeze", location: "Los Angeles", icon: "sun", tempC: 26, tempF: 79, condition: "Sunny" },
  },
  {
    id: "seoul",
    city: "Seoul",
    tagline: "Crisp Spring",
    climate: { label: "17°C Cool & Overcast", location: "Seoul", icon: "cloud", tempC: 17, tempF: 62, condition: "Overcast" },
  },
  {
    id: "tokyo",
    city: "Tokyo",
    tagline: "Mild Overcast",
    climate: { label: "18°C Mild Overcast", location: "Tokyo", icon: "cloud", tempC: 18, tempF: 64, condition: "Overcast" },
  },
  {
    id: "paris",
    city: "Paris",
    tagline: "Cool Drizzle",
    climate: { label: "13°C Cool & Drizzly", location: "Paris", icon: "rain", tempC: 13, tempF: 55, condition: "Rain" },
  },
  {
    id: "london",
    city: "London",
    tagline: "Overcast Chill",
    climate: { label: "11°C Overcast & Damp", location: "London", icon: "rain", tempC: 11, tempF: 52, condition: "Rain" },
  },
  {
    id: "nyc",
    city: "New York",
    tagline: "Brisk Autumn",
    climate: { label: "10°C Brisk & Windy", location: "New York", icon: "wind", tempC: 10, tempF: 50, condition: "Windy" },
  },
  {
    id: "stockholm",
    city: "Stockholm",
    tagline: "Frost & Snow",
    climate: { label: "-2°C Frosty with light snow", location: "Stockholm", icon: "snow", tempC: -2, tempF: 28, condition: "Snow" },
  },
];

function iconFor(code: number): ClimateIcon {
  // Open-Meteo WMO weather codes
  if (code === 0 || code === 1) return "sun";
  if (code === 2 || code === 3) return "cloud";
  if ([45, 48].includes(code)) return "cloud";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  return "cloud";
}

function conditionFor(code: number, windKph: number): ClimateCondition {
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return "Rain";
  if (code === 0 || code === 1) return "Sunny";
  if (windKph >= 25) return "Windy";
  if (code === 3 || [45, 48].includes(code)) return "Overcast";
  return "Cloudy";
}

function moodFor(tempF: number, condition: ClimateCondition): string {
  if (condition === "Snow") return "frosted, hushed";
  if (condition === "Rain") return "wet, moody";
  if (tempF < 40) return "frosty";
  if (tempF < 55) return condition === "Overcast" || condition === "Cloudy" ? "cool, gray" : "crisp";
  if (tempF < 65) return condition === "Sunny" ? "fresh, sunlit" : "cool, gray";
  if (tempF < 75) return condition === "Sunny" ? "mild, sunlit" : "mild";
  if (tempF < 85) return condition === "Sunny" ? "warm, golden" : "warm";
  return "hot, radiant";
}

export function climateSyncLine(c: ClimateState): string {
  const mood = moodFor(c.tempF, c.condition);
  const loc = c.location && c.location !== "—" && c.location !== "Your location" ? c.location : "Local";
  return `${loc} · Mila Climate Sync: ${c.tempF}°F, ${c.condition}. Pulling tailored outfit ideas for a ${mood} day.`;
}

function describe(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55].includes(code)) return "Light drizzle";
  if ([56, 57].includes(code)) return "Freezing drizzle";
  if ([61, 63, 65].includes(code)) return "Rain";
  if ([66, 67].includes(code)) return "Freezing rain";
  if ([71, 73, 75].includes(code)) return "Snow";
  if (code === 77) return "Snow grains";
  if ([80, 81, 82].includes(code)) return "Rain showers";
  if ([85, 86].includes(code)) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if ([96, 99].includes(code)) return "Thunderstorm with hail";
  return "Mild";
}

function ClimateGlyph({ icon, className }: { icon: ClimateIcon; className?: string }) {
  const cls = className ?? "h-4 w-4";
  if (icon === "sun") return <Sun className={cls} strokeWidth={1.5} />;
  if (icon === "rain") return <CloudRain className={cls} strokeWidth={1.5} />;
  if (icon === "snow") return <CloudSnow className={cls} strokeWidth={1.5} />;
  if (icon === "wind") return <Wind className={cls} strokeWidth={1.5} />;
  return <Cloud className={cls} strokeWidth={1.5} />;
}

export function ClimateSyncChip({ value }: { value: ClimateState }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-atelier-champagne/40 bg-gradient-to-r from-atelier-ivory/70 via-background/60 to-atelier-champagne/20 backdrop-blur px-4 py-2 shadow-[0_2px_18px_-8px_rgba(0,0,0,0.25)]">
      <span className="grid place-items-center h-7 w-7 rounded-full border border-atelier-champagne/50 bg-background/70 text-foreground">
        <ClimateGlyph icon={value.icon} className="h-3.5 w-3.5" />
      </span>
      <p className="text-[11px] sm:text-xs font-medium tracking-[0.04em] text-foreground/85 leading-snug">
        {climateSyncLine(value)}
      </p>
    </div>
  );
}

export function ClimateWidget({
  value,
  onChange,
}: {
  value: ClimateState;
  onChange: (c: ClimateState) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [hubId, setHubId] = useState<string>("manila");

  async function detect() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const r = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m`,
          );
          const j = await r.json();
          const temp = Math.round(j?.current?.temperature_2m ?? 20);
          const wind = Math.round(j?.current?.wind_speed_10m ?? 0);
          const code = j?.current?.weather_code ?? 2;
          const ic = iconFor(code);
          const desc = describe(code);
          const windy = wind >= 25 ? " & Windy" : "";
          const finalIcon: ClimateIcon = wind >= 25 && ic === "cloud" ? "wind" : ic;
          onChange({
            label: `${temp}°C ${desc}${windy}`,
            location: "Your location",
            icon: finalIcon,
            tempC: temp,
            tempF: Math.round(temp * 9 / 5 + 32),
            condition: conditionFor(code, wind),
          });
        } catch {
          // ignore — keep current selection
        } finally {
          setLoading(false);
        }
      },
      () => setLoading(false),
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }

  useEffect(() => {
    // initialize with default hub on mount
    onChange(HUBS[0].climate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/20 bg-background/40 backdrop-blur px-4 py-3 min-w-[220px]">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center h-8 w-8 rounded-full border border-white/20 bg-foreground/[0.04] text-foreground">
          <ClimateGlyph icon={value.icon} className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-medium">{value.label}</p>
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {value.location}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={hubId}
          onValueChange={(id) => {
            const hub = HUBS.find((h) => h.id === id);
            if (hub) {
              setHubId(id);
              onChange(hub.climate);
            }
          }}
        >
          <SelectTrigger className="h-8 rounded-full text-[11px] uppercase tracking-[0.18em] bg-background/60">
            <SelectValue placeholder="Pick a hub">
              {HUBS.find((h) => h.id === hubId)?.city.toUpperCase()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {HUBS.map((h) => (
              <SelectItem key={h.id} value={h.id} className="text-xs">
                {h.city} — {h.tagline}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={detect}
          disabled={loading}
          title="Use my location"
          className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-full border border-white/20 bg-background/60 hover:bg-foreground hover:text-background transition-colors"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MapPin className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </button>
      </div>
    </div>
  );
}

export { ClimateGlyph };