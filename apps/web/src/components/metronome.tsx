import { BEAT_GROUPINGS, beatsFromGrouping, defaultBeats, metronomeForSong, NEXT_BEAT_LEVEL, type BeatLevel, type MetronomeSettings, type TempoUnit } from "@oneverse/core";
import { tempoText } from "#/lib/tempo-unit";
import { Link, useRouterState } from "@tanstack/react-router";
import { Metronome, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { startMetronome, stopMetronome, useMetronome, useMetronomeBeat, type MetronomeBeat } from "#/lib/metronome-engine";
import { unlockSyncAudio } from "#/lib/sync-client";
import { cn } from "@oneverse/ui/lib/utils";

/** A dot's size per level (issue #384): accent biggest, then medium, then small; off hollow. */
const DOT_SIZE: Record<"large" | "small", Record<BeatLevel, string>> = {
  large: { accent: "size-12", medium: "size-10", normal: "size-8", mute: "size-8" },
  small: { accent: "size-2.5", medium: "size-2", normal: "size-1.5", mute: "size-1.5" },
};

/**
 * A light per beat of the bar (issue #2): the one playing lit, its size
 * its level (accent, medium, small), silent ones hollow. On the Metronome
 * page, clicking one changes how it sounds: accent, medium, small, off.
 */
export function BeatLights({
  settings,
  beat,
  onChange,
  size = "large",
}: {
  settings: Pick<MetronomeSettings, "beats">;
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
              DOT_SIZE[size][level],
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
            onClick={() => onChange(settings.beats.map((l, i) => (i === index ? NEXT_BEAT_LEVEL[l] : l)))}
          >
            {dot}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A bar's pattern to edit (issue #384): its lights, a tap changing a beat's
 * level; for a bar of 5 or 7, how its beats are grouped (3+2, 2+3…); and,
 * changed, a way back to the time signature's usual pattern.
 */
export function PatternEditor({
  beats,
  timeSignature,
  beat = null,
  onChange,
  disabled,
  testId = "metronome-pattern",
}: {
  beats: BeatLevel[];
  timeSignature: { numerator: number; denominator: number };
  beat?: MetronomeBeat | null;
  onChange: (beats: BeatLevel[]) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const usual = defaultBeats(timeSignature);
  const same = (a: readonly BeatLevel[], b: readonly BeatLevel[]) => a.length === b.length && a.every((level, i) => level === b[i]);
  const groupings = BEAT_GROUPINGS[timeSignature.numerator] ?? [];
  return (
    <div className="flex flex-col items-center gap-3" data-testid={testId}>
      <BeatLights settings={{ beats }} beat={beat} onChange={disabled ? undefined : onChange} />
      {disabled ? null : (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {groupings.map((groups) => {
            const pattern = beatsFromGrouping(groups);
            const label = groups.join("+");
            return (
              <Button
                key={label}
                type="button"
                size="sm"
                variant={same(pattern, beats) ? "default" : "outline"}
                aria-pressed={same(pattern, beats)}
                title={t("metronome.groupingHint", { grouping: label })}
                onClick={() => onChange(pattern)}
                data-testid="metronome-grouping"
              >
                {label}
              </Button>
            );
          })}
          {same(beats, usual) ? null : (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(usual)} data-testid="metronome-usual-pattern">
              {t("metronome.usualPattern")}
            </Button>
          )}
        </div>
      )}
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
  tempoUnit,
  timeSignature,
  metronomeBeats,
  variant = "icon",
  className,
}: {
  songId: string;
  tempo: number | null | undefined;
  /** The note the tempo counts (issue #377); null: the time signature's default. */
  tempoUnit?: TempoUnit | null;
  timeSignature?: { numerator: number; denominator: number } | null;
  /** The version's own pattern (issue #384); null: the player's. */
  metronomeBeats?: BeatLevel[] | null;
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
    if (tempo) startMetronome(metronomeForSong(metronome.settings, { tempo, tempoUnit, timeSignature, beats: metronomeBeats }), songId);
  };
  // The beat, on the button, whatever started it: a flash on each, stronger on the first of the bar.
  const flash = metronome.playing && beat ? (beat.beat === 0 ? "bg-primary text-primary-foreground" : "bg-primary/30") : null;
  if (variant === "button") {
    return (
      <Button type="button" variant="outline" onClick={press} disabled={!tempo && !following} aria-pressed={mine} title={label} className={cn(flash, className)} data-testid="metronome-song">
        <Metronome />
        {mine ? t("metronome.stop") : tempo ? tempoText(tempo, tempoUnit, timeSignature) : t("metronome.title")}
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
