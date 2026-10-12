import { useRef, useState } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";

/**
 * hCaptcha is defence-in-depth in front of the auth flows: Supabase Auth
 * (project -> Authentication -> Attack Protection) is the authoritative gate,
 * so the widget can be dropped without weakening the server-side check.
 *
 * It is off unless VITE_CAPTCHA_ENABLED=true is present at build time; the token
 * the forms then receive is a placeholder, which Supabase ignores while its own
 * captcha protection is off. Pair the switch with CAPTCHA_ENABLED=true on the
 * server (src/lib/hcaptcha.server.ts) whenever it is turned back on.
 */
export const CAPTCHA_ENABLED = import.meta.env.VITE_CAPTCHA_ENABLED === "true";
export const CAPTCHA_PLACEHOLDER_TOKEN = "captcha-disabled";

export function useCaptcha() {
  const ref = useRef<HCaptcha>(null);
  const [token, setToken] = useState<string | null>(
    CAPTCHA_ENABLED ? null : CAPTCHA_PLACEHOLDER_TOKEN,
  );
  const clear = () => setToken(null);

  return {
    token,
    reset: () => {
      ref.current?.resetCaptcha();
      setToken(CAPTCHA_ENABLED ? null : CAPTCHA_PLACEHOLDER_TOKEN);
    },
    field: CAPTCHA_ENABLED ? (
      <div className="flex justify-center">
        <HCaptcha
          ref={ref}
          sitekey={import.meta.env.VITE_HCAPTCHA_SITEKEY!}
          onVerify={setToken}
          onExpire={clear}
          onError={clear}
        />
      </div>
    ) : null,
  };
}
