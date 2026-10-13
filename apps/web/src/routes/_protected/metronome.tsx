import { clampTempo, MAX_BEATS_PER_BAR, MAX_TEMPO, METRONOME_DENOMINATORS, METRONOME_SOUNDS, MIN_TEMPO, tapTempo, type MetronomeSound, type Subdivision } from "@songverse/core";
import { createFileRoute } from "@tanstack/react-router";
import { Minus, Play, Plus, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BeatLights } from "#/components/metronome";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { startMetronome, stopMetronome, updateMetronome, useMetronome, useMetronomeBeat } from "#/lib/metronome-engine";
import { unlockSyncAudio } from "#/lib/sync-client";
import { cn } from "@songverse/ui/lib/utils";

export const Route = createFileRoute("/_protected/metronome")({
  component: MetronomePage,
});

/**
 * The Metronome (issue #2), from the sidebar: every setting, a light per
 * beat to set the pattern, tap tempo. It keeps going on other pages; Live,
 * Practice and a song's page start it at the song's tempo with a button.
 */
function MetronomePage() {
  const { t } = useTranslation();
  const { settings, playing, following, audioBlocked } = useMetronome();
  // Following Sync play's leader (issue #13): only the sound and volume are this device's.
  const locked = !!following;
  const beat = useMetronomeBeat();
  const taps = useRef<number[]>([]);
  // The tempo as typed, applied once it's a number.
  const [typed, setTyped] = useState<string | null>(null);

  // Space starts and stops; the arrows change the tempo (by 5 with Shift). Not while typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (locked || target?.closest("input, select, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " ") {
        // A focused button would also take the Space: this is it.
        event.preventDefault();
        if (playing) stopMetronome();
        else startMetronome();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        updateMetronome({ tempo: settings.tempo + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 5 : 1) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, settings.tempo, locked]);

  const tap = () => {
    taps.current = [...taps.current, performance.now()].slice(-12);
    const tempo = tapTempo(taps.current);
    if (tempo) updateMetronome({ tempo });
  };

  return (
    <div className="flex w-full flex-col gap-6" data-testid="metronome-page">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("metronome.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("metronome.description")}</p>
      </div>
      {following ? (
        <p className="rounded-md border-l-4 border-primary bg-muted px-3 py-2 text-sm" data-testid="metronome-following">
          {t("sync.followingMetronome", { name: following })}
        </p>
      ) : null}
      {/* Back after a reload, the browser waits for a press before it makes a sound. */}
      {audioBlocked && playing ? (
        <Button type="button" className="self-start" onClick={unlockSyncAudio}>
          <Volume2 />
          {t("sync.tapToHear")}
        </Button>
      ) : null}

      {/* With room (issue #177): the beat and its settings side by side. */}
      <div className="grid grid-cols-1 items-start gap-6 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardContent className="flex flex-col items-center gap-6">
          <p className="h-5 text-sm font-medium text-muted-foreground" data-testid="metronome-bar" aria-live="off">
            {beat ? (beat.countIn ? t("metronome.countingIn") : t("metronome.bar", { bar: beat.bar + 1 })) : null}
          </p>
          <BeatLights settings={settings} beat={beat} onChange={locked ? undefined : (beats) => updateMetronome({ beats })} />
          <p className="text-center text-xs text-muted-foreground">{t("metronome.patternHint")}</p>

          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" className="size-12 rounded-full" onClick={() => updateMetronome({ tempo: settings.tempo - 1 })} aria-label={t("metronome.slower")} disabled={locked || settings.tempo <= MIN_TEMPO}>
              <Minus />
            </Button>
            <label className="flex flex-col items-center">
              <Input
                type="number"
                inputMode="numeric"
                min={MIN_TEMPO}
                max={MAX_TEMPO}
                disabled={locked}
                value={typed ?? String(settings.tempo)}
                onChange={(event) => {
                  setTyped(event.target.value);
                  const value = Number(event.target.value);
                  if (event.target.value && value >= MIN_TEMPO && value <= MAX_TEMPO) updateMetronome({ tempo: value });
                }}
                onBlur={() => setTyped(null)}
                className="h-16 w-32 [appearance:textfield] text-center text-5xl font-semibold tabular-nums md:text-5xl [&::-webkit-inner-spin-button]:appearance-none"
                aria-label={t("metronome.tempo")}
                data-testid="metronome-tempo"
              />
              <span className="text-xs font-medium text-muted-foreground">{t("metronome.bpm")}</span>
            </label>
            <Button type="button" variant="outline" size="icon" className="size-12 rounded-full" onClick={() => updateMetronome({ tempo: settings.tempo + 1 })} aria-label={t("metronome.faster")} disabled={locked || settings.tempo >= MAX_TEMPO}>
              <Plus />
            </Button>
          </div>
          <input
            type="range"
            min={MIN_TEMPO}
            max={MAX_TEMPO}
            value={settings.tempo}
            disabled={locked}
            onChange={(event) => updateMetronome({ tempo: clampTempo(Number(event.target.value)) })}
            className="w-full max-w-md accent-primary"
            aria-label={t("metronome.tempo")}
          />

          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" className="h-12 rounded-full px-6" onClick={tap} title={t("metronome.tapHint")} disabled={locked} data-testid="metronome-tap">
              {t("metronome.tap")}
            </Button>
            <Button
              type="button"
              className="h-12 rounded-full px-8 text-base"
              onClick={() => (playing ? stopMetronome() : startMetronome())}
              disabled={locked}
              aria-pressed={playing}
              data-testid="metronome-play"
            >
              {playing ? <Square /> : <Play />}
              {playing ? t("metronome.stop") : t("metronome.start")}
            </Button>
          </div>
          <p className="hidden text-xs text-muted-foreground md:block">{t("metronome.keys")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t("metronome.timeSignature")}</legend>
            <div className="flex items-center gap-2">
              <NativeSelect disabled={locked} value={settings.numerator} onChange={(event) => updateMetronome({ numerator: Number(event.target.value) })} aria-label={t("metronome.beatsPerBar")} data-testid="metronome-numerator">
                {Array.from({ length: MAX_BEATS_PER_BAR }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-lg text-muted-foreground">/</span>
              <NativeSelect disabled={locked} value={settings.denominator} onChange={(event) => updateMetronome({ denominator: Number(event.target.value) })} aria-label={t("metronome.beatUnit")} data-testid="metronome-denominator">
                {METRONOME_DENOMINATORS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor="metronome-subdivision">{t("metronome.subdivision")}</Label>
            <NativeSelect id="metronome-subdivision" disabled={locked} value={settings.subdivision} onChange={(event) => updateMetronome({ subdivision: Number(event.target.value) as Subdivision })}>
              {([1, 2, 3, 4] as const).map((n) => (
                <option key={n} value={n}>
                  {t(`metronome.subdivision_${n}`)}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="metronome-count-in">{t("metronome.countIn")}</Label>
            <NativeSelect id="metronome-count-in" disabled={locked} value={settings.countIn} onChange={(event) => updateMetronome({ countIn: Number(event.target.value) })}>
              {[0, 1, 2].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? t("metronome.noCountIn") : t("metronome.countInBars", { count: n })}
                </option>
              ))}
            </NativeSelect>
            <label className={cn("flex items-start gap-2 text-sm", settings.countIn === 0 && "opacity-50")}>
              <input
                type="checkbox"
                className="mt-0.5 accent-primary"
                checked={settings.countInOnly}
                disabled={locked || settings.countIn === 0}
                onChange={(event) => updateMetronome({ countInOnly: event.target.checked })}
              />
              <span className="flex flex-col">
                {t("metronome.countInOnly")}
                <span className="text-xs text-muted-foreground">{t("metronome.countInOnlyHint")}</span>
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="metronome-sound">{t("metronome.sound")}</Label>
            <NativeSelect id="metronome-sound" value={settings.sound} onChange={(event) => updateMetronome({ sound: event.target.value as MetronomeSound })}>
              {METRONOME_SOUNDS.map((sound) => (
                <option key={sound} value={sound}>
                  {t(`metronome.sound_${sound}`)}
                </option>
              ))}
            </NativeSelect>
            <Label htmlFor="metronome-volume" className="mt-2">
              {t("metronome.volume")}
            </Label>
            <input
              id="metronome-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(event) => updateMetronome({ volume: Number(event.target.value) })}
              className="accent-primary"
            />
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
