const VERIFY_URL = "https://hcaptcha.com/siteverify";
const VERIFY_TIMEOUT_MS = 8_000;

export async function verifyHcaptcha(token: string | undefined | null, remoteIp?: string) {
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) {
    console.error("[hcaptcha] HCAPTCHA_SECRET is not configured");
    throw new Error("Captcha verification is not available. Please try again later.");
  }
  if (!token || typeof token !== "string" || token.length === 0 || token.length > 4000) {
    throw new Error("Captcha verification failed. Please try again.");
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
  } catch {
    throw new Error("Captcha verification failed. Please try again.");
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error("Captcha verification failed. Please try again.");
  }

  const json = (await res.json()) as { success?: boolean };
  if (json.success !== true) {
    throw new Error("Captcha verification failed. Please try again.");
  }
}
