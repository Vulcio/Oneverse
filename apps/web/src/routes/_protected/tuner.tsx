import { MAX_A4, MIN_A4, nearestString, noteName, octaveOf, parseNoteName, TEMPERAMENTS, TUNER_INSTRUMENTS, TUNER_SENSITIVITIES, tunerInstrument, tunerTuning, midiToHz, type Temperament, type TunerSensitivity } from "@oneverse/core";
import { createFileRoute } from "@tanstack/react-router";
import { Mic, MicOff, Minus, Plus } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NeedleDisplay, SpectrumDisplay, StrobeDisplay, WheelDisplay } from "#/components/tuner/displays";
import { Button } from "@oneverse/ui/components/button";
import { ButtonGroup } from "@oneverse/ui/components/button-group";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@oneverse/ui/components/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@oneverse/ui/components/tabs";
import { cn } from "@oneverse/ui/lib/utils";
import { IN_TUNE_CENTS, resumeTuner, startTuner, stopTuner, TUNER_DISPLAYS, updateTunerSettings, useTuner, type TunerDisplay, type TunerSettings } from "#/lib/tuner-engine";

export const Route = createFileRoute("/_protected/tuner")({
  component: TunerPage,
});

/** Keys to tune a temperament from, named as they're usually written. */
const KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const FLAT_KEYS = new Set([1, 3, 5, 8, 10]);
const A4_PRESETS = [432, 435, 440, 441, 442, 443, 444];

/**
 * The Tuner (issue #3), in the sidebar's Tools beside the metronome: the
 * nearest note and how far off, in cents, on a strobe, a wheel, a needle or
 * a spectrum; an instrument's strings to tune to; the concert pitch, a
 * temperament from a key, the detector and the microphone's sensitivity -
 * all kept on this device. Built from brice's strobe tuner.
 */
function TunerPage() {
  const { t } = useTranslation();
  const { status, settings, reading } = useTuner();
  const listening = status === "listening" || status === "paused";
  // The microphone is let go when the page is.
  useEffect(() => () => stopTuner(), []);

  const instrument = tunerInstrument(settings.instrument);
  const tuning = tunerTuning(instrument, settings.tuning);
  const flats = FLAT_KEYS.has(settings.tonic) || !!tuning?.strings.some((name) => /b\d/.test(name));
  const good = !!reading?.live && Math.abs(reading.cents) < IN_TUNE_CENTS;
  const cents = reading ? Math.max(-50, Math.min(50, reading.cents)) : 0;
  const centsText = reading ? `${cents > 0 ? "+" : ""}${settings.precision === "whole" ? Math.round(cents) : cents.toFixed(1)}` : "";
  const string = reading && tuning ? nearestString(reading.hz, tuning.strings, settings.a4) : -1;

  return (
    <div className="flex w-full flex-col gap-6" data-testid="tuner">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("nav.tuner")}</h1>
        <p className="text-sm text-muted-foreground">{t("tuner.description")}</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="flex flex-col gap-5">
            {/* What's tuned: an instrument and its tuning, or any note. */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={instrument.id} onValueChange={(value) => value && updateTunerSettings({ instrument: value as string, tuning: null })}>
                <SelectTrigger className="w-auto min-w-36" aria-label={t("tuner.instrument")} data-testid="tuner-instrument">
                  <SelectValue>{(value: string) => t(`tuner.instruments.${value}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TUNER_INSTRUMENTS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {t(`tuner.instruments.${item.id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {instrument.tunings.length > 1 && tuning ? (
                <Select value={tuning.id} onValueChange={(value) => value && updateTunerSettings({ tuning: value as string })}>
                  <SelectTrigger className="w-auto min-w-36" aria-label={t("tuner.tuning")} data-testid="tuner-tuning">
                    <SelectValue>{(value: string) => t(`tuner.tunings.${value}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {instrument.tunings.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {t(`tuner.tunings.${item.id}`)} <span className="text-muted-foreground">{item.strings.map((name) => name.replace(/-?\d+$/, "")).join(" ")}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums" data-testid="tuner-a4">
                {t("tuner.a4Short", { hz: settings.a4 })}
              </span>
            </div>

            {/* The note, how far off, and the frequency. */}
            <div className="flex flex-col items-center gap-1" aria-live="polite" data-testid="tuner-readout" data-note={reading ? `${noteName(reading.midi, flats)}${octaveOf(reading.midi)}` : ""} data-in-tune={good ? "true" : "false"}>
              <div className="flex items-baseline gap-3">
                <span className={cn("text-7xl font-semibold tabular-nums", good && "text-emerald-500", !reading?.live && reading && "opacity-60")} data-testid="tuner-note">
                  {reading ? noteName(reading.midi, flats) : "—"}
                  <sub className="ml-0.5 text-2xl font-medium text-muted-foreground">{reading ? octaveOf(reading.midi) : ""}</sub>
                </span>
                <span className={cn("w-24 text-2xl font-medium tabular-nums", good ? "text-emerald-500" : reading && Math.abs(cents) > 30 ? "text-destructive" : "text-muted-foreground")} data-testid="tuner-cents">
                  {good ? t("tuner.inTune") : reading ? t("tuner.cents", { cents: centsText }) : ""}
                </span>
              </div>
              <span className="h-4 text-xs text-muted-foreground tabular-nums">{reading ? t("tuner.hz", { hz: reading.hz.toFixed(1) }) : ""}</span>
              {/* How sure the reading is. */}
              <div className="h-0.5 w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className={cn("h-full transition-[width]", reading && reading.confidence > 0.6 ? "bg-emerald-500" : "bg-muted-foreground")} style={{ width: `${Math.round((reading?.confidence ?? 0) * 100)}%` }} />
              </div>
            </div>

            <Tabs value={settings.display} onValueChange={(value) => updateTunerSettings({ display: value as TunerDisplay })}>
              <TabsList className="self-center" aria-label={t("tuner.display")}>
                {TUNER_DISPLAYS.map((display) => (
                  <TabsTrigger key={display} value={display} data-testid={`tuner-display-${display}`}>
                    {t(`tuner.displays.${display}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="strobe">
                <StrobeDisplay bands={settings.bands} />
              </TabsContent>
              <TabsContent value="wheel">
                <WheelDisplay />
              </TabsContent>
              <TabsContent value="needle">
                <NeedleDisplay />
              </TabsContent>
              <TabsContent value="spectrum">
                <SpectrumDisplay />
              </TabsContent>
            </Tabs>

            {/* A quick read of the same: left flat, right sharp. */}
            <div className="relative h-1.5 rounded-full bg-muted" aria-hidden>
              <div className="absolute top-1/2 left-1/2 h-3 w-px -translate-y-1/2 bg-muted-foreground" />
              <div
                className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left]", good ? "bg-emerald-500" : Math.abs(cents) > 30 ? "bg-destructive" : "bg-primary", !reading && "opacity-0")}
                style={{ left: `${50 + cents}%` }}
              />
            </div>

            {/* The strings to tune: the one being played lit, green when it's in tune. */}
            {tuning ? (
              <div className="flex justify-center gap-1.5 sm:gap-2" data-testid="tuner-strings">
                {tuning.strings.map((name, index) => {
                  const midi = parseNoteName(name);
                  const on = index === string;
                  return (
                    <div
                      key={`${name}-${index}`}
                      className={cn("flex max-w-14 min-w-0 flex-1 flex-col items-center rounded-md border px-1 py-1", on && (good ? "border-emerald-500 text-emerald-500" : "border-primary text-primary"))}
                      data-testid="tuner-string"
                      data-active={on ? "true" : "false"}
                    >
                      <span className="text-lg font-semibold">{name.replace(/-?\d+$/, "")}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{midi !== null ? t("tuner.hz", { hz: midiToHz(midi, settings.a4).toFixed(0) }) : ""}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="flex flex-col items-center gap-2">
              <Button
                type="button"
                className="h-12 rounded-full px-8 text-base"
                variant={listening ? "secondary" : "default"}
                onClick={() => (status === "paused" ? resumeTuner() : listening ? stopTuner() : void startTuner())}
                disabled={status === "starting"}
                aria-pressed={listening}
                data-testid="tuner-start"
              >
                {listening ? <MicOff /> : <Mic />}
                {status === "paused" ? t("tuner.resume") : listening ? t("tuner.stop") : t("tuner.start")}
              </Button>
              <p className={cn("text-center text-xs", ["denied", "no-microphone", "unsupported", "disconnected", "failed"].includes(status) ? "text-destructive" : "text-muted-foreground")} role="status" data-testid="tuner-status" data-status={status}>
                {t(`tuner.status.${status}`)}
              </p>
            </div>
          </CardContent>
        </Card>

        <TunerSettingsCard settings={settings} />
      </div>
    </div>
  );
}

/** One choice among a few, as a row of joined buttons. */
function Choice<T extends string>({ value, options, label, onChange, testId }: { value: T; options: { value: T; label: ReactNode }[]; label: string; onChange: (value: T) => void; testId: string }) {
  return (
    <ButtonGroup aria-label={label} data-testid={testId} className="flex-wrap">
      {options.map((option) => (
        <Button key={option.value} type="button" size="sm" variant={option.value === value ? "default" : "secondary"} aria-pressed={option.value === value} onClick={() => onChange(option.value)} data-value={option.value}>
          {option.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}

/** The settings, in three tabs: the pitch tuned to, the microphone, the display. */
function TunerSettingsCard({ settings }: { settings: TunerSettings }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent>
        <Tabs defaultValue="pitch" className="gap-5">
          <TabsList className="w-full" aria-label={t("tuner.settings")}>
            <TabsTrigger value="pitch" data-testid="tuner-settings-pitch">
              {t("tuner.tabs.pitch")}
            </TabsTrigger>
            <TabsTrigger value="microphone" data-testid="tuner-settings-microphone">
              {t("tuner.tabs.microphone")}
            </TabsTrigger>
            <TabsTrigger value="display" data-testid="tuner-settings-display">
              {t("tuner.tabs.display")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pitch" className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="tuner-a4">{t("tuner.a4")}</Label>
              <ButtonGroup>
                <Button type="button" variant="secondary" size="icon" onClick={() => updateTunerSettings({ a4: settings.a4 - 1 })} disabled={settings.a4 <= MIN_A4} aria-label={t("tuner.a4Down")}>
                  <Minus />
                </Button>
                <Input
                  id="tuner-a4"
                  type="number"
                  inputMode="decimal"
                  min={MIN_A4}
                  max={MAX_A4}
                  step={0.5}
                  value={settings.a4}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (value >= MIN_A4 && value <= MAX_A4) updateTunerSettings({ a4: value });
                  }}
                  className="w-20 rounded-none text-center tabular-nums"
                  data-testid="tuner-a4-input"
                />
                <Button type="button" variant="secondary" size="icon" onClick={() => updateTunerSettings({ a4: settings.a4 + 1 })} disabled={settings.a4 >= MAX_A4} aria-label={t("tuner.a4Up")}>
                  <Plus />
                </Button>
              </ButtonGroup>
              <div className="flex flex-wrap gap-1.5">
                {A4_PRESETS.map((hz) => (
                  <Button key={hz} type="button" size="sm" variant={settings.a4 === hz ? "default" : "outline"} className="h-7 rounded-full px-3 tabular-nums" onClick={() => updateTunerSettings({ a4: hz })}>
                    {hz}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("tuner.temperament")}</Label>
              <div className="flex flex-wrap gap-2">
                <Select value={settings.temperament} onValueChange={(value) => value && updateTunerSettings({ temperament: value as Temperament })}>
                  <SelectTrigger className="w-auto min-w-36" aria-label={t("tuner.temperament")} data-testid="tuner-temperament">
                    <SelectValue>{(value: Temperament) => t(`tuner.temperaments.${value}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPERAMENTS.map((temperament) => (
                      <SelectItem key={temperament} value={temperament}>
                        {t(`tuner.temperaments.${temperament}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {settings.temperament !== "equal" ? (
                  <Select value={String(settings.tonic)} onValueChange={(value) => value !== null && updateTunerSettings({ tonic: Number(value) })}>
                    <SelectTrigger className="w-auto min-w-24" aria-label={t("tuner.key")} data-testid="tuner-key">
                      <SelectValue>{(value: string) => t("tuner.inKey", { key: KEY_NAMES[Number(value)] })}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {KEY_NAMES.map((name, tonic) => (
                        <SelectItem key={name} value={String(tonic)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{t(`tuner.temperamentHints.${settings.temperament}`)}</p>
            </div>
          </TabsContent>

          <TabsContent value="microphone" className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>{t("tuner.sensitivity")}</Label>
              <Choice<TunerSensitivity>
                value={settings.sensitivity}
                options={TUNER_SENSITIVITIES.map((value) => ({ value, label: t(`tuner.sensitivities.${value}`) }))}
                label={t("tuner.sensitivity")}
                onChange={(sensitivity) => updateTunerSettings({ sensitivity })}
                testId="tuner-sensitivity"
              />
              <p className="text-xs text-muted-foreground">{t("tuner.sensitivityHint")}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("tuner.detector")}</Label>
              <Choice
                value={settings.detector}
                options={[
                  { value: "mpm", label: "MPM" },
                  { value: "yin", label: "YIN" },
                ]}
                label={t("tuner.detector")}
                onChange={(detector) => updateTunerSettings({ detector })}
                testId="tuner-detector"
              />
              <p className="text-xs text-muted-foreground">{t(`tuner.detectorHints.${settings.detector}`)}</p>
            </div>
          </TabsContent>

          <TabsContent value="display" className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>{t("tuner.precision")}</Label>
              <Choice
                value={settings.precision}
                options={[
                  { value: "tenth", label: "±0.1¢" },
                  { value: "whole", label: "±1¢" },
                ]}
                label={t("tuner.precision")}
                onChange={(precision) => updateTunerSettings({ precision })}
                testId="tuner-precision"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("tuner.bands")}</Label>
              <Choice
                value={settings.bands}
                options={[
                  { value: "octave", label: t("tuner.bandsOctave") },
                  { value: "harmonic", label: t("tuner.bandsHarmonic") },
                ]}
                label={t("tuner.bands")}
                onChange={(bands) => updateTunerSettings({ bands })}
                testId="tuner-bands"
              />
              <p className="text-xs text-muted-foreground">{t("tuner.bandsHint")}</p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
