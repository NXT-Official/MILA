import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

// TanStack Start's server-function IDs are content-hashed per deployment. A
// tab left open across a deploy still runs the old client bundle, which
// calls a hash the new deployment's server never registered — surfacing as
// this exact message instead of a normal HTTP error. Confirmed live: the
// same hash 500'd as "not found" across two consecutive deployments,
// ruling out a transient server bug. Detecting it lets callers force a
// reload instead of showing a raw internal error string and letting the
// action silently keep failing.
const STALE_BUNDLE_ERROR = /server function info not found/i;

export function isStaleBundleError(error: unknown): boolean {
  return STALE_BUNDLE_ERROR.test(errorMessage(error, ""));
}

export function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
] as const;

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  if (!Number.isFinite(seconds)) return "";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, "second");
}
