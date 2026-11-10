import { ChevronsDown, Pause, Rabbit, Turtle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@oneverse/ui/lib/utils";

/** Autoscroll's speeds, as a share of the song's own pace. */
export const AUTOSCROLL_SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** The next speed up or down, kept within the list. */
export function stepAutoscrollSpeed(speed: number, step: 1 | -1): number {
  const at = AUTOSCROLL_SPEEDS.indexOf(speed);
  return AUTOSCROLL_SPEEDS[Math.min(AUTOSCROLL_SPEEDS.length - 1, Math.max(0, (at === -1 ? AUTOSCROLL_SPEEDS.indexOf(1) : at) + step))]!;
}

/** Autoscroll's own icon (issue #414): the page going down, a pause while it does - never Play, which is for sound. */
export function AutoscrollIcon({ playing }: { playing: boolean }) {
  return playing ? <Pause /> : <ChevronsDown />;
}

/**
 * Practice's autoscroll (issue #414): a round button at the bottom right,
 * above whatever is docked there; slower and faster beside it once it runs.
 */
export function FloatingAutoscroll({
  playing,
  onToggle,
  onHide,
  speed,
  onSpeed,
  disabled,
  following,
}: {
  playing: boolean;
  onToggle: () => void;
  /** It's gone (another view): autoscroll stops. */
  onHide?: () => void;
  speed: number;
  onSpeed: (speed: number) => void;
  disabled?: boolean;
  /** The music plays: autoscroll follows it, at its pace. */
  following?: boolean;
}) {
  const { t } = useTranslation();
  const hide = useRef(onHide);
  hide.current = onHide;
  useEffect(() => () => hide.current?.(), []);
  const round = "flex size-11 items-center justify-center rounded-full border bg-background/95 text-muted-foreground shadow-md backdrop-blur hover:bg-accent hover:text-accent-foreground disabled:opacity-40 [&_svg]:size-5";
  return (
    <div
      className="fixed right-4 z-30 flex items-center gap-1.5 sm:right-6"
      style={{ bottom: "calc(var(--stem-dock-height, 0px) + 1rem)" }}
      role="group"
      aria-label={t("live.autoscroll")}
      data-testid="practice-autoscroll"
    >
      {playing && !following ? (
        <>
          <button type="button" className={round} aria-label={t("live.slower")} title={t("live.slower")} onClick={() => onSpeed(stepAutoscrollSpeed(speed, -1))} disabled={speed === AUTOSCROLL_SPEEDS[0]}>
            <Turtle />
          </button>
          <button type="button" className={round} aria-label={t("live.faster")} title={t("live.faster")} onClick={() => onSpeed(stepAutoscrollSpeed(speed, 1))} disabled={speed === AUTOSCROLL_SPEEDS.at(-1)}>
            <Rabbit />
          </button>
        </>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={playing ? t("live.pause") : t("live.play")}
        title={playing ? t("live.pause") : t("live.play")}
        aria-pressed={playing}
        className={cn(
          "flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium shadow-md disabled:opacity-40 [&_svg]:size-5",
          playing ? "bg-primary text-primary-foreground" : "border bg-background/95 backdrop-blur hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <AutoscrollIcon playing={playing} />
        <span className="tabular-nums" data-testid="practice-autoscroll-label">
          {playing ? (following ? t("live.withTheMusic") : `${Math.round(speed * 100)}%`) : t("live.autoscroll")}
        </span>
      </button>
    </div>
  );
}
