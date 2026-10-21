import { STEM_SPEED_MAX, STEM_SPEED_MIN, STEM_SPEED_STEP } from "@oneverse/core";
import { Gauge, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";

export const speedPercent = (speed: number) => `${Math.round(speed * 100)}%`;

/**
 * Slower or faster, in the same key (issue #139): 50-150% by 5%, the
 * percentage back to 100% when tapped. The stem player's, and the YouTube
 * dock's.
 */
export function SpeedControl({ speed, onChange, disabled = false, testId = "stem-speed" }: { speed: number; onChange: (speed: number) => void; disabled?: boolean; testId?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center" role="group" aria-label={t("stems.speed")} data-testid={testId} data-speed={speed}>
      <Gauge className={cn("mx-1 size-4 shrink-0", speed !== 1 ? "text-primary" : "text-muted-foreground")} aria-hidden />
      <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || speed <= STEM_SPEED_MIN} onClick={() => onChange(speed - STEM_SPEED_STEP)} aria-label={t("stems.slower")} data-testid={`${testId}-down`}>
        <Minus />
      </Button>
      <button
        type="button"
        className={cn("min-w-10 rounded-sm text-center text-xs tabular-nums", speed !== 1 && "font-semibold text-primary")}
        disabled={disabled || speed === 1}
        onClick={() => onChange(1)}
        title={speed !== 1 ? t("stems.speedReset") : t("stems.speedTitle")}
        data-testid={`${testId}-label`}
      >
        {speedPercent(speed)}
      </button>
      <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || speed >= STEM_SPEED_MAX} onClick={() => onChange(speed + STEM_SPEED_STEP)} aria-label={t("stems.faster")} data-testid={`${testId}-up`}>
        <Plus />
      </Button>
    </div>
  );
}
