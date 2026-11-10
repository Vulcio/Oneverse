import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@oneverse/ui/lib/utils";
import { setThemeChoice, useThemeChoice, type ThemeChoice } from "../theme";

const CHOICES: { value: ThemeChoice; icon: LucideIcon }[] = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "device", icon: Monitor },
];

/** Light, dark, or as the device is (issue #422), remembered on this device. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { t } = useTranslation();
  const choice = useThemeChoice();
  return (
    <div role="radiogroup" aria-label={t("theme.label")} data-testid="theme-switch" className={cn("inline-flex items-center gap-0.5 rounded-lg border bg-background p-0.5", className)}>
      {CHOICES.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={t(`theme.${value}`)}
          title={t(`theme.${value}`)}
          data-testid={`theme-${value}`}
          onClick={() => setThemeChoice(value)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4",
            choice === value && "bg-accent text-accent-foreground",
          )}
        >
          <Icon aria-hidden />
        </button>
      ))}
    </div>
  );
}
