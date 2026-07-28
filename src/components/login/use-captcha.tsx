import { useRef, useState } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";

export function useCaptcha() {
  const ref = useRef<HCaptcha>(null);
  const [token, setToken] = useState<string | null>(null);
  const clear = () => setToken(null);

  return {
    token,
    reset: () => {
      ref.current?.resetCaptcha();
      setToken(null);
    },
    field: (
      <div className="flex justify-center">
        <HCaptcha
          ref={ref}
          sitekey={import.meta.env.VITE_HCAPTCHA_SITEKEY!}
          onVerify={setToken}
          onExpire={clear}
          onError={clear}
        />
      </div>
    ),
  };
}
