import { Moon, Sun, SunMoon } from "lucide-react";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { IconButton } from "@/components/ui/icon-button";

const NEXT: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };

const ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: SunMoon };

// `size` only so the landing header's slim pill can shrink it; the app shell
// keeps the default 44px target.
export function ThemeToggle({ size = "md" }: { size?: "sm" | "md" }) {
  const { theme, setTheme } = useTheme();
  const Icon = ICONS[theme];

  return (
    <IconButton
      variant="glass"
      size={size}
      onClick={() => setTheme(NEXT[theme])}
      label={`Theme: ${theme}. Switch to ${NEXT[theme]}`}
      title={`Theme: ${theme}`}
      // The same glass the credits and Lens chips wear, so the header is one
      // border treatment rather than three.
      className="rounded-pill"
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
    </IconButton>
  );
}
