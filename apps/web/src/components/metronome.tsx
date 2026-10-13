import { metronomeForSong, type BeatLevel, type MetronomeSettings } from "@songverse/core";
import { Link, useRouterState } from "@tanstack/react-router";
import { Metronome, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { startMetronome, stopMetronome, useMetronome, useMetronomeBeat, type MetronomeBeat } from "#/lib/metronome-engine";
import { unlockSyncAudio } from "#/lib/sync-client";
import { cn } from "@songverse/ui/lib/utils";

const NEXT_LEVEL: Record<BeatLevel, BeatLevel> = { accent: "normal", normal: "mute", mute: "accent" };

/**
 * A light per beat of the bar (issue #2): the one playing lit, accented
 * beats bigger, silent ones hollow. On the Metronome page, clicking one
 * changes how it sounds.
 */
export function BeatLights({
  settings,
  beat,
  onChange,
  size = "large",
}: {
  settings: MetronomeSettings;
  beat: MetronomeBeat | null;
  onChange?: (beats: BeatLevel[]) => void;
  size?: "large" | "small";
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-wrap items-center justify-center", size === "large" ? "gap-3" : "gap-1")} data-testid="metronome-beats">
      {settings.beats.map((level, index) => {
        const lit = beat?.beat === index;
        const dot = (
          <span
            className={cn(
              "block rounded-full border-2 transition-[background-color,transform] duration-75",
              size === "large" ? (level === "accent" ? "size-12" : "size-9") : level === "accent" ? "size-2.5" : "size-2",
              level === "mute" ? "border-muted-foreground/50 bg-transparent" : "border-primary",
              level !== "mute" && !lit && "bg-primary/15",
              lit && "scale-110",
              lit && (beat.countIn ? "border-amber-500 bg-amber-500" : level === "mute" ? "border-primary bg-primary/30" : "bg-primary"),
            )}
          />
        );
        if (!onChange) return <span key={index}>{dot}</span>;
        return (
          <button
            key={index}
            type="button"
            className="flex size-14 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("metronome.beatLabel", { n: index + 1, level: t(`metronome.level_${level}`) })}
            data-level={level}
            data-lit={lit || undefined}
            onClick={() => onChange(settings.beats.map((l, i) => (i === index ? NEXT_LEVEL[l] : l)))}
          >
            {dot}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The metronome at a song's tempo and time signature (Live, Practice, a
 * song's page): one press starts it, the next stops it; the pattern, sound
 * and the rest are the player's, from the Metronome page. Playing for
 * another song (or changed since), a press switches it to this one.
 */
export function MetronomeSongButton({
  songId,
  tempo,
  timeSignature,
  variant = "icon",
  className,
}: {
  songId: string;
  tempo: number | null | undefined;
  timeSignature?: { numerator: number; denominator: number } | null;
  variant?: "icon" | "button";
  className?: string;
}) {
  const { t } = useTranslation();
  const metronome = useMetronome();
  const beat = useMetronomeBeat();
  const mine = metronome.playing && metronome.songId === songId;
  // Following Sync play's leader (issue #13): theirs; a press only lets the browser make sound.
  const following = metronome.following;
  const label = following
    ? t("sync.followingShort", { name: following })
    : !tempo
      ? t("metronome.noTempo")
      : mine
        ? t("metronome.songStop")
        : t("metronome.songStart", { tempo });
  const press = () => {
    if (following) return unlockSyncAudio();
    if (mine) return stopMetronome();
    if (tempo) startMetronome(metronomeForSong(metronome.settings, { tempo, timeSignature }), songId);
  };
  // The beat, on the button, whatever started it: a flash on each, stronger on the first of the bar.
  const flash = metronome.playing && beat ? (beat.beat === 0 ? "bg-primary text-primary-foreground" : "bg-primary/30") : null;
  if (variant === "button") {
    return (
      <Button type="button" variant="outline" onClick={press} disabled={!tempo && !following} aria-pressed={mine} title={label} className={cn(flash, className)} data-testid="metronome-song">
        <Metronome />
        {mine ? t("metronome.stop") : tempo ? `${tempo} BPM` : t("metronome.title")}
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={press}
      disabled={!tempo && !following}
      aria-label={label}
      aria-pressed={mine}
      title={label}
      data-testid="metronome-song"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5",
        mine && "text-foreground",
        flash,
        className,
      )}
    >
      <Metronome />
    </button>
  );
}

/** While it plays, off the Metronome page and Live: its tempo and beat at the bottom, back to its page, and stop. */
export function MetronomeReturnButton() {
  const { t } = useTranslation();
  const metronome = useMetronome();
  const beat = useMetronomeBeat();
  const onPage = useRouterState({ select: (s) => s.location.pathname === "/metronome" });
  if (!metronome.playing || onPage) return null;
  return (
    <div
      className="fixed bottom-4 left-4 z-50 flex items-center gap-1 rounded-full border bg-background p-1 shadow-lg md:left-auto md:right-4 md:bottom-20"
      role="region"
      aria-label={t("metronome.playing", { tempo: metronome.settings.tempo })}
      data-testid="metronome-return"
    >
      <Link to="/metronome" className="flex items-center gap-2 rounded-full py-1.5 pr-3 pl-2 text-sm font-medium hover:bg-accent" aria-label={t("metronome.settings")}>
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Metronome className="size-4" />
        </span>
        <span className="tabular-nums">{metronome.settings.tempo} BPM</span>
        <BeatLights settings={metronome.settings} beat={beat} size="small" />
      </Link>
      {/* Following Sync play's leader: theirs to stop. */}
      {metronome.following ? null : (
        <Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={stopMetronome} aria-label={t("metronome.stop")}>
          <Square />
        </Button>
      )}
    </div>
  );
}
