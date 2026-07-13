export function requireEnv<T extends Record<string, string | undefined>>(
  vars: T,
): { [K in keyof T]: string } {
  const missing = Object.keys(vars).filter((k) => !vars[k]);
  if (missing.length) {
    const message = `Missing environment variable(s): ${missing.join(", ")}. Set them in .env (see .env.example).`;
    console.error(message);
    throw new Error(message);
  }
  return vars as { [K in keyof T]: string };
}
