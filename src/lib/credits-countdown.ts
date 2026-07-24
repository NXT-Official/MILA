export function formatResetCountdown(now: Date): string {
  const nextMidnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const msRemaining = nextMidnightUtc - now.getTime();
  const totalMinutes = Math.max(0, Math.ceil(msRemaining / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
