import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Server functions reject with an Error carrying a message written for the
 * member; anything else that reaches a catch block is an unknown failure and
 * gets the caller's fallback instead of leaking a stringified internal.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
