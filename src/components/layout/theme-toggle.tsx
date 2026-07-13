import { Moon, Sun, SunMoon } from "lucide-react";
import { useTheme, type Theme } from "@/components/layout/theme-provider";
import { IconButton } from "@/components/ui/icon-button";

const NEXT: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };

const ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: SunMoon };

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = ICONS[theme];

  return (
    <IconButton
      variant="outline"
      size="sm"
      onClick={() => setTheme(NEXT[theme])}
      label={`Theme: ${theme}. Switch to ${NEXT[theme]}`}
      title={`Theme: ${theme}`}
      className="rounded-pill border-line/60 bg-canvas/60 backdrop-blur hover:border-line"
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
    </IconButton>
  );
}
