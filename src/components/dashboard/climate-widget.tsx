import { useEffect, useRef, useState } from "react";
import { Sun, Cloud, CloudRain, CloudSnow, Wind, MapPin, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HUBS,
  type ClimateIcon,
  type ClimateState,
  type ClimateCondition,
} from "@/constants/climate";
import { useAuth } from "@/hooks/use-auth";
import { fetchDefaultHubId, localDefaultHubId } from "@/lib/default-hub";

function iconFor(code: number): ClimateIcon {
  if (code === 0 || code === 1) return "sun";
  if (code === 2 || code === 3) return "cloud";
  if ([45, 48].includes(code)) return "cloud";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code))
    return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  return "cloud";
}

function conditionFor(code: number, windKph: number): ClimateCondition {
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code))
    return "Rain";
  if (code === 0 || code === 1) return "Sunny";
  if (windKph >= 25) return "Windy";
  if (code === 3 || [45, 48].includes(code)) return "Overcast";
  return "Cloudy";
}

function moodFor(tempF: number, condition: ClimateCondition): string {
  if (condition === "Snow") return "frosted, hushed";
  if (condition === "Rain") return "wet, moody";
  if (tempF < 40) return "frosty";
  if (tempF < 55)
    return condition === "Overcast" || condition === "Cloudy" ? "cool, gray" : "crisp";
  if (tempF < 65) return condition === "Sunny" ? "fresh, sunlit" : "cool, gray";
  if (tempF < 75) return condition === "Sunny" ? "mild, sunlit" : "mild";
  if (tempF < 85) return condition === "Sunny" ? "warm, golden" : "warm";
  return "hot, radiant";
}

export function climateSyncLine(c: ClimateState): string {
  const mood = moodFor(c.tempF, c.condition);
  const loc =
    c.location && c.location !== "—" && c.location !== "Your location" ? c.location : "Local";
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

async function fetchClimate(lat: number, lon: number, location: string): Promise<ClimateState> {
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`,
  );
  const j = await r.json();
  const temp = Math.round(j?.current?.temperature_2m ?? 20);
  const wind = Math.round(j?.current?.wind_speed_10m ?? 0);
  const code = j?.current?.weather_code ?? 2;
  const ic = iconFor(code);
  const windy = wind >= 25 ? " & Windy" : "";
  return {
    label: `${temp}°C ${describe(code)}${windy}`,
    location,
    icon: wind >= 25 && ic === "cloud" ? "wind" : ic,
    tempC: temp,
    tempF: Math.round((temp * 9) / 5 + 32),
    condition: conditionFor(code, wind),
  };
}

function ClimateGlyph({ icon, className }: { icon: ClimateIcon; className?: string }) {
  const cls = className ?? "size-4";
  if (icon === "sun") return <Sun className={cls} strokeWidth={1.75} />;
  if (icon === "rain") return <CloudRain className={cls} strokeWidth={1.75} />;
  if (icon === "snow") return <CloudSnow className={cls} strokeWidth={1.75} />;
  if (icon === "wind") return <Wind className={cls} strokeWidth={1.75} />;
  return <Cloud className={cls} strokeWidth={1.75} />;
}

export function ClimateSyncChip({ value }: { value: ClimateState }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-atelier-champagne/40 bg-linear-to-r from-atelier-ivory/70 via-background/60 to-atelier-champagne/20 backdrop-blur px-4 py-2 shadow-paper">
      <span className="grid place-items-center size-7 rounded-full border border-atelier-champagne/50 bg-background/70 text-foreground">
        <ClimateGlyph icon={value.icon} className="size-3.5" />
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
  value: ClimateState | null;
  onChange: (c: ClimateState) => void;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [hubId, setHubId] = useState<string>("manila");
  // ponytail: seq guard so a slow response can't overwrite a newer selection
  const seq = useRef(0);

  async function selectHub(id: string) {
    const hub = HUBS.find((h) => h.id === id);
    if (!hub) return;
    const req = ++seq.current;
    setHubId(id);
    setLoading(true);
    setError(false);
    try {
      const live = await fetchClimate(hub.lat, hub.lon, hub.city);
      if (req === seq.current) onChange(live);
    } catch {
      if (req === seq.current) setError(true);
    } finally {
      if (req === seq.current) setLoading(false);
    }
  }

  async function detect() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const req = ++seq.current;
    setLoading(true);
    setError(false);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const live = await fetchClimate(
            pos.coords.latitude,
            pos.coords.longitude,
            "Your location",
          );
          if (req === seq.current) onChange(live);
        } catch {
          if (req === seq.current) setError(true);
        } finally {
          if (req === seq.current) setLoading(false);
        }
      },
      () => {
        if (req === seq.current) {
          setError(true);
          setLoading(false);
        }
      },
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }

  useEffect(() => {
    // Profile value wins; localStorage covers pre-auth render and offline.
    let cancelled = false;
    (async () => {
      const remote = user ? await fetchDefaultHubId(user.id) : null;
      if (!cancelled) selectHub(remote ?? localDefaultHubId() ?? HUBS[0].id);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const statusLabel = loading
    ? "Detecting weather…"
    : (value?.label ?? (error ? "Weather unavailable" : "Detecting weather…"));

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/20 bg-background/40 backdrop-blur px-4 py-3 min-w-55">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center size-8 rounded-full border border-white/20 bg-foreground/4 text-foreground">
          <ClimateGlyph icon={value?.icon ?? "cloud"} className="size-4" />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-medium">{statusLabel}</p>
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {value?.location ?? "—"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select value={hubId} onValueChange={selectHub}>
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
          className="shrink-0 inline-flex items-center justify-center size-8 rounded-full border border-white/20 bg-background/60 hover:bg-foreground hover:text-background transition-colors"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <MapPin className="size-3.5" strokeWidth={1.75} />
          )}
        </button>
      </div>
    </div>
  );
}

export { ClimateGlyph };
