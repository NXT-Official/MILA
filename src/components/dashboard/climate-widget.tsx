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
  climateForWeatherCode,
  type ClimateIcon,
  type ClimateState,
} from "@/constants/climate";
import { useAuth } from "@/hooks/use-auth";
import { fetchDefaultHubId, localDefaultHubId } from "@/lib/default-hub";

async function fetchClimate(lat: number, lon: number, location: string): Promise<ClimateState> {
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`,
  );
  const j = await r.json();
  const temp = Math.round(j?.current?.temperature_2m ?? 20);
  const wind = Math.round(j?.current?.wind_speed_10m ?? 0);
  const code = j?.current?.weather_code ?? 2;
  const weather = climateForWeatherCode(code, wind);
  const windy = wind >= 25 ? " & Windy" : "";
  return {
    label: `${temp}°C ${weather.description}${windy}`,
    location,
    icon: weather.icon,
    tempC: temp,
    tempF: Math.round((temp * 9) / 5 + 32),
    condition: weather.condition,
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
    let cancelled = false;
    (async () => {
      const remote = user ? await fetchDefaultHubId(user.id) : null;
      if (!cancelled) selectHub(remote ?? localDefaultHubId() ?? HUBS[0].id);
    })();
    return () => {
      cancelled = true;
    };
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
