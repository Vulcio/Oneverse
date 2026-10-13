import { alignTake, encodeWav, formatDuration, hasSound, mergeTake, partKind, type RecordingDetails } from "@songverse/core";
import { Circle, Hand, ListPlus, Loader2, Mic, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InputLevel } from "#/components/input-level";
import { PartPicker, usePartLabel, type PartChoice } from "#/components/part-picker";
import { Button } from "@songverse/ui/components/button";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { Recorder, type Take } from "#/lib/recorder";
import {
  directStemsOutput,
  pauseStems,
  playStems,
  seekStems,
  setStemsTake,
  stemMono,
  stemsAudioContext,
  stemsZeroAt,
  TAKE_ID,
  toggleStemMute,
  useStems,
  type StemSong,
} from "#/lib/stem-engine";
import { cn } from "@songverse/ui/lib/utils";

/** A take can be this long at most: its WAV file stays under the upload limit for audio (50 MB). */
const MAX_BYTES = 50 * 1024 * 1024 - 1024;

type Phase = "arming" | "ready" | "recording" | "recorded" | "saving";
type Use = { kind: "instead"; id: string } | { kind: "with" } | { kind: "aside" };
const useValue = (use: Use) => (use.kind === "instead" ? `instead:${use.id}` : use.kind);
const useOf = (value: string): Use => (value.startsWith("instead:") ? { kind: "instead", id: value.slice(8) } : value === "aside" ? { kind: "aside" } : { kind: "with" });

/**
 * Recording in the stem player (issue #134): a minimal multitrack
 * recorder. The take is recorded over the player's own mix - its mutes,
 * solos and transposition - from the playhead (the start of its bar, after
 * a bar of count-in), on the player's clock, so it lines up with what was
 * heard. Then it's a track like the others, to play, nudge, keep or drop.
 * Sung while transposed, it says how far (issue #135). A part can be
 * recorded in sections (issue #141): each one kept goes into the same take,
 * replacing only the time it covers, and the whole is kept as one file.
 */
export function StemRecordPanel({
  song,
  into = null,
  onClose,
  onNewMultitrack,
}: {
  song: StemSong;
  /** A recording to record into (issue #142): its part, sections punched into it. */
  into?: string | null;
  onClose: () => void;
  /** Records the first layer of another multitrack instead (the dialog). */
  onNewMultitrack: () => void;
}) {
  const { t } = useTranslation();
  const engine = useStems();
  const partLabel = usePartLabel();
  const recorder = useRef<Recorder | null>(null);
  // The recorder once it's open, for the microphone's level (issue #141).
  const [opened, setOpened] = useState<Recorder | null>(null);
  // The sections kept so far, merged (issue #141): what the next one goes into.
  const sections = useRef<Float32Array | null>(null);
  const [sectionCount, setSectionCount] = useState(0);
  const [phase, setPhase] = useState<Phase>("arming");
  const [error, setError] = useState<string | null>(null);
  const [micRefused, setMicRefused] = useState(false);
  // The part: a voice by default - the first of the lead and harmonies not there yet (issue #131).
  const firstFree = (["VOCALS", "HARMONY_SOPRANO", "HARMONY_ALTO", "HARMONY_TENOR", "HARMONY_BASS"] as const).find((voice) => !song.stems.some((file) => file.stemPart === voice && !file.partName));
  const intoFile = into ? song.stems.find((file) => file.id === into) : undefined;
  const [choice, setChoice] = useState<PartChoice>(intoFile?.stemPart ? { stemPart: intoFile.stemPart, partName: intoFile.partName ?? null } : { stemPart: firstFree ?? "BACKING_VOCALS", partName: null });
  const part = choice.stemPart ?? "OTHER";
  const samePart = song.stems.filter((file) => file.stemPart === part && (file.partName ?? null) === (choice.partName ?? null) && file.canChange && !file.locked);
  const [use, setUse] = useState<Use>({ kind: "with" });
  useEffect(() => {
    const first = samePart.find((file) => file.id === into) ?? samePart[0];
    setUse(first ? { kind: "instead", id: first.id } : { kind: "with" });
  }, [part, choice.partName]);
  const [level, setLevel] = useState(true);
  const [noise, setNoise] = useState(false);
  const [voiceCleanUp, setVoiceCleanUp] = useState(false);
  const [roundTrip, setRoundTrip] = useState<{ seconds: number; measured: boolean } | null>(null);
  const [bluetooth, setBluetooth] = useState(false);
  const [calibrating, setCalibrating] = useState<"loopback" | "claps" | null>(null);
  const [clapBeat, setClapBeat] = useState(-1);
  const [calibrationFailed, setCalibrationFailed] = useState<"loopback" | "claps" | null>(null);
  // Where the take starts (s), and when the song's 0:00 was heard while recording.
  const [from, setFrom] = useState(0);
  const zeroAt = useRef(0);
  const [take, setTake] = useState<Take | null>(null);
  const [nudge, setNudge] = useState(0);
  // The take as it comes in: its loudness, block by block.
  const [live, setLive] = useState<number[]>([]);
  const [silent, setSilent] = useState(false);
  const mutedForTake = useRef<string | null>(null);

  // Where it would start: the playhead, at the start of its bar (with a tempo).
  const beat = engine.beat;
  const bar = beat ? (60 / beat.tempo) * (beat.timeSignature?.numerator ?? 4) : 0;
  const snapped = (position: number) => (beat && position >= beat.firstBeat ? beat.firstBeat + Math.floor((position - beat.firstBeat) / bar + 1e-6) * bar : beat ? 0 : position);
  const startAt = snapped(engine.position);
  const barNumber = beat && startAt >= beat.firstBeat ? Math.round((startAt - beat.firstBeat) / bar) + 1 : null;

  /** Asks for the microphone, on the player's clock (from the Record tap, or Allow the microphone). */
  function arm() {
    setError(null);
    setMicRefused(false);
    const context = stemsAudioContext();
    if (!context) return setError(t("recorder.stemsNotLoaded"));
    directStemsOutput();
    void context.resume();
    Recorder.open(context)
      .then(async (opened) => {
        recorder.current = opened;
        setOpened(opened);
        opened.onChunk = (data) => {
          let peak = 0;
          for (let i = 0; i < data.length; i += 8) peak = Math.max(peak, Math.abs(data[i]!));
          setLive((peaks) => [...peaks, peak]);
        };
        setRoundTrip(opened.roundTrip());
        setBluetooth((await opened.bluetoothOutput()) || opened.context.outputLatency > 0.1);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        const refused = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
        setMicRefused(refused);
        setError(refused ? t("recorder.noMicrophone") : t("recorder.cantOpen"));
      });
  }

  useEffect(() => {
    arm();
    return () => {
      recorder.current?.close();
      recorder.current = null;
      if (mutedForTake.current) toggleStemMute(mutedForTake.current);
      void setStemsTake(null);
    };
  }, []);

  // Another song or multitrack loaded: the recorder was on the old one's clock.
  const loadedKey = useRef(engine.key);
  useEffect(() => {
    if (engine.key !== loadedKey.current) onClose();
  }, [engine.key]);

  async function record() {
    const current = recorder.current;
    if (!current) return;
    setError(null);
    setNudge(0);
    setLive([]);
    // The sections so far heard while recording the next one; nothing new yet.
    await showSamples(sections.current);
    setTake(null);
    const start = startAt;
    setFrom(start);
    // The take it replaces isn't heard over it.
    if (use.kind === "instead" && !engine.muted.has(use.id) && !mutedForTake.current) {
      toggleStemMute(use.id);
      mutedForTake.current = use.id;
    }
    // A bar of count-in (2 s without a tempo), as far back as the song goes.
    pauseStems();
    seekStems(Math.max(0, start - (bar || 2)));
    current.startCapture();
    await playStems(song);
    zeroAt.current = stemsZeroAt() ?? 0;
    stopping.current = false;
    setPhase("recording");
  }

  // Stopped once: Stop pauses the player, which would stop it again (and find nothing left captured).
  const stopping = useRef(false);
  async function stop() {
    const current = recorder.current;
    if (!current || stopping.current) return;
    stopping.current = true;
    pauseStems();
    const done = await current.finish(zeroAt.current);
    // For the end-to-end suites: what was captured, against when the song's 0:00 was heard.
    (window as unknown as { songverseTake?: object }).songverseTake = { captured: done.captured.length, capturedAt: done.capturedAt, zeroAt: done.zeroAt, sampleRate: done.sampleRate, from };
    setTake(done);
    setPhase("recorded");
    // Nothing from the microphone: said so, and nothing to keep.
    const silent = !hasSound(done.captured, done.sampleRate);
    setSilent(silent);
    if (silent) return setError(t("recorder.silent"));
    await showTake(done, nudge);
  }

  /**
   * The take as it will be kept: lined up (nudged), from where it starts to
   * where it stopped, into the sections kept so far - else into the part it
   * replaces, what's either side kept (issue #141) - else silent either side.
   */
  function samples(done: Take, nudgeMs: number): Float32Array {
    const delay = (recorder.current?.roundTrip().seconds ?? 0) + nudgeMs / 1000;
    const aligned = alignTake(done.captured, { sampleRate: done.sampleRate, capturedAt: done.capturedAt, zeroAt: done.zeroAt, delay });
    const base = sections.current ?? (use.kind === "instead" ? stemMono(use.id) : null);
    return mergeTake(base, aligned, Math.round(from * done.sampleRate));
  }

  /** The take as a track the player plays with the others; null, none. */
  async function showSamples(merged: Float32Array | null, count = sectionCount) {
    const name = t("recorder.newTake", { part: partLabel(choice) }) + (count > 1 ? ` · ${t("recorder.sectionsCount", { count })}` : "");
    await setStemsTake(merged ? { samples: merged, part, partName: choice.partName, name, offset: engine.transpose } : null);
  }

  async function showTake(done: Take, nudgeMs: number) {
    await showSamples(samples(done, nudgeMs), sectionCount + 1);
  }

  // Nudged: the take moved, heard as it will be kept.
  useEffect(() => {
    if (phase !== "recorded" || !take) return;
    const timer = setTimeout(() => void showTake(take, nudge), 150);
    return () => clearTimeout(timer);
  }, [nudge]);

  // The time while recording, and the limit.
  useEffect(() => {
    if (phase !== "recording") return;
    const context = stemsAudioContext();
    if (!context) return;
    const limit = MAX_BYTES / 2 / context.sampleRate;
    if (engine.position - from > limit || !engine.playing) void stop();
  }, [phase, engine.position, engine.playing]);

  async function keep() {
    const current = recorder.current;
    // The take just recorded with the sections before it, or those alone.
    const merged = take && !silent ? samples(take, nudge) : sections.current;
    const context = stemsAudioContext();
    if (!current || !merged || !context) return;
    pauseStems();
    setPhase("saving");
    setError(null);
    try {
      const wav = encodeWav(merged, take?.sampleRate ?? context.sampleRate);
      const file = new File([wav as Uint8Array<ArrayBuffer>], `${song.title} - ${partLabel(choice)}.wav`, { type: "audio/wav" });
      const first = song.stems[0];
      const details: RecordingDetails = {
        ...(song.multitrackId ? { multitrackId: song.multitrackId } : {}),
        ...(first?.multitrackName ? { multitrackName: first.multitrackName } : {}),
        ...(first?.recordingKey ? { recordingKey: first.recordingKey } : {}),
        ...(first?.recordingTempo != null ? { recordingTempo: first.recordingTempo } : {}),
        ...(first?.recordingTimeSignature ? { recordingTimeSignature: first.recordingTimeSignature } : {}),
        ...(first?.recordingFirstBeat != null ? { recordingFirstBeat: first.recordingFirstBeat } : {}),
        ...(first?.recordingFreeIntro ? { recordingFreeIntro: true } : {}),
        ...(first?.multitrackSetlistId ? { multitrackSetlistId: first.multitrackSetlistId } : {}),
        // Sung while the player was transposed (issue #135): that far above the multitrack.
        ...(engine.transpose ? { pitchOffset: engine.transpose } : {}),
        ...(choice.partName ? { partName: choice.partName } : {}),
        process: ["encode", partKind(part) === "VOICE" && voiceCleanUp ? "voice" : null, level ? "level" : null, noise ? "noise" : null].filter(Boolean).join(","),
        ...(use.kind === "aside" ? { otherTake: true } : {}),
      };
      const saved = await apiClient.uploadAttachment(song.songVersionId, "AUDIO", file, part, { visibility: "PRIVATE" }, details);
      if (use.kind === "instead") await apiClient.useTake(song.songVersionId, saved.id, use.id);
      song.record?.onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("recorded");
    }
  }

  /** The take just recorded dropped: back to the sections kept, if any. */
  async function discard() {
    pauseStems();
    setTake(null);
    setNudge(0);
    setSilent(false);
    setError(null);
    await showSamples(sections.current);
    setPhase("ready");
  }

  /** Every section dropped: a fresh start. */
  async function discardAll() {
    sections.current = null;
    setSectionCount(0);
    await discard();
  }

  /** The take just recorded kept as a section (issue #141); the next one recorded goes in with it. */
  async function addSection() {
    if (!take || silent) return;
    pauseStems();
    const merged = samples(take, nudge);
    sections.current = merged;
    const count = sectionCount + 1;
    setSectionCount(count);
    setTake(null);
    setNudge(0);
    setPhase("ready");
    await showSamples(merged, count);
  }

  async function calibrate(method: "loopback" | "claps") {
    const current = recorder.current;
    if (!current) return;
    pauseStems();
    setCalibrating(method);
    setCalibrationFailed(null);
    const measured = method === "loopback" ? await current.calibrate() : await current.calibrateByClapping(setClapBeat);
    setCalibrating(null);
    setClapBeat(-1);
    if (measured === null) setCalibrationFailed(method);
    setRoundTrip(current.roundTrip());
  }

  const busy = phase === "arming" || phase === "recording" || phase === "saving" || calibrating !== null;
  const duration = engine.duration || 1;
  const fileName = (file: { filename: string }) => file.filename.replace(/\.[a-z0-9]+$/i, "");

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2 text-sm sm:p-3" data-testid="stem-record-panel" data-phase={phase}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {phase === "recording" ? (
          <Button type="button" variant="destructive" size="sm" onClick={() => void stop()} data-testid="stem-record-stop">
            <Square />
            {t("recorder.stop")}
          </Button>
        ) : (
          <Button type="button" variant="destructive" size="sm" onClick={() => void record()} disabled={phase !== "ready" && phase !== "recorded"} data-testid="stem-record-start">
            {phase === "arming" && !error ? <Loader2 className="animate-spin" /> : <Circle className="fill-current" />}
            {phase === "recorded" ? t("recorder.again") : t("recorder.record")}
          </Button>
        )}
        <span className="text-xs text-muted-foreground" data-testid="stem-record-from">
          {phase === "recording"
            ? engine.position < from
              ? t("recorder.countIn")
              : t("recorder.recordingAt", { time: formatDuration(engine.position) })
            : barNumber
              ? t("recorder.fromBarTime", { bar: barNumber, time: formatDuration(startAt) })
              : t("recorder.fromTime", { time: formatDuration(startAt) })}
        </span>
        <span className="min-w-0 flex-1" />
        {phase === "ready" && sectionCount > 0 ? (
          <span className="text-xs font-medium" data-testid="stem-record-sections">
            {t("recorder.sectionsCount", { count: sectionCount })}
          </span>
        ) : null}
        {phase === "recorded" || phase === "saving" || (phase === "ready" && sectionCount > 0) ? (
          <>
            {phase === "ready" ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => void discardAll()} data-testid="stem-record-discard-all">
                <Trash2 />
                {t("recorder.discardAll")}
              </Button>
            ) : (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={() => void discard()} disabled={phase === "saving"} data-testid="stem-record-discard">
                  <Trash2 />
                  {t("recorder.discard")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void addSection()} disabled={phase === "saving" || silent} data-testid="stem-record-add-section">
                  <ListPlus />
                  {t("recorder.addSection")}
                </Button>
              </>
            )}
            <Button type="button" size="sm" onClick={() => void keep()} disabled={phase === "saving" || (phase === "recorded" && silent)} data-testid="stem-record-keep">
              {phase === "saving" ? <Loader2 className="animate-spin" /> : null}
              {phase === "saving" ? t("recorder.saving") : t("recorder.keep")}
            </Button>
          </>
        ) : null}
        {(phase === "ready" || phase === "arming") && sectionCount === 0 ? (
          <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={onNewMultitrack} data-testid="stem-record-new">
            {t("recorder.newMultitrackEllipsis")}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onClose} disabled={phase === "recording" || phase === "saving"} aria-label={t("recorder.closePanel")}>
          <X />
        </Button>
      </div>

      {/* What the microphone hears, before a take and during it: loud enough? (issue #141) */}
      {phase === "ready" || phase === "recording" ? <InputLevel recorder={opened} /> : null}
      {phase === "ready" && sectionCount > 0 ? <p className="text-xs text-muted-foreground">{t("recorder.sectionsHint")}</p> : null}
      {/* Nothing from the microphone a moment in: said now, not after the take. */}
      {phase === "recording" && live.length > 16 && Math.max(...live) < 0.0005 ? (
        <p className="flex items-start gap-2 text-xs text-destructive" role="alert" data-testid="stem-record-silent">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("recorder.silent")}
        </p>
      ) : null}
      {/* The take as it comes in, where it's being recorded. */}
      {phase === "recording" ? (
        <div className="relative h-8 w-full" aria-hidden data-testid="stem-record-live">
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
          <svg
            viewBox={`0 0 ${Math.max(1, live.length)} 100`}
            preserveAspectRatio="none"
            className="absolute h-8"
            style={{ left: `${(from / duration) * 100}%`, width: `${(Math.max(0, engine.position - from) / duration) * 100}%` }}
          >
            <path d={live.map((peak, i) => `M${i} ${50 - Math.max(1, peak * 48)}h0.8v${Math.max(2, peak * 96)}h-0.8z`).join("")} className="fill-destructive" />
          </svg>
        </div>
      ) : null}

      {phase === "recorded" || phase === "saving" ? (
        <label className="flex items-center gap-2 text-xs">
          <span className="shrink-0">{t("recorder.nudge")}</span>
          <input
            type="range"
            min={-150}
            max={150}
            step={1}
            value={nudge}
            className="min-w-0 flex-1 accent-primary"
            disabled={phase === "saving"}
            onChange={(event) => setNudge(Number(event.target.value))}
            aria-label={t("recorder.nudge")}
            data-testid="stem-record-nudge"
          />
          <span className="w-16 shrink-0 text-right tabular-nums">{t("recorder.nudgeMs", { ms: nudge > 0 ? `+${nudge}` : nudge })}</span>
        </label>
      ) : null}

      <div className={cn("flex flex-col gap-2", (phase === "recording" || phase === "saving") && "pointer-events-none opacity-60")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("recorder.part")}</span>
          <PartPicker compact value={choice} disabled={busy || phase === "recorded" || sectionCount > 0} label={t("recorder.part")} onChange={(next) => setChoice({ stemPart: next.stemPart ?? "VOCALS", partName: next.partName })} />
          <NativeSelect compact value={useValue(use)} disabled={busy || phase === "recorded" || sectionCount > 0} aria-label={t("recorder.use")} onChange={(event) => setUse(useOf(event.target.value))} data-testid="stem-record-use">
            {samePart.map((file) => (
              <option key={file.id} value={`instead:${file.id}`}>
                {t("recorder.useInstead", { name: file.partName || fileName(file) })}
              </option>
            ))}
            <option value="with">{t("recorder.useWith")}</option>
            <option value="aside">{t("recorder.useAside")}</option>
          </NativeSelect>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={level} onChange={(event) => setLevel(event.target.checked)} />
            {t("recorder.level")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={noise} onChange={(event) => setNoise(event.target.checked)} />
            {t("recorder.noise")}
          </label>
          {partKind(part) === "VOICE" ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={voiceCleanUp} onChange={(event) => setVoiceCleanUp(event.target.checked)} />
              {t("recorder.voiceCleanUp")}
            </label>
          ) : null}
        </div>
        {bluetooth ? (
          <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("recorder.bluetooth")}
          </p>
        ) : null}
        {roundTrip ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="stem-record-latency">
            <span>
              {t("recorder.headphonesShort")} {t(roundTrip.measured ? "recorder.delayMeasured" : "recorder.delayEstimated", { ms: Math.round(roundTrip.seconds * 1000) })}
            </span>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={busy} onClick={() => void calibrate("claps")}>
              <Hand />
              {t("recorder.clapAlong")}
            </Button>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={busy} onClick={() => void calibrate("loopback")}>
              {calibrating === "loopback" ? t("recorder.measuring") : t("recorder.measure")}
            </Button>
            {calibrating === "claps" ? (
              <span className="w-full font-medium text-foreground" role="status">
                {clapBeat < 2 ? t("recorder.clapGetReady") : t("recorder.clapNow", { count: clapBeat - 1 })}
              </span>
            ) : null}
            {calibrationFailed ? <span className="w-full text-destructive">{t(calibrationFailed === "claps" ? "recorder.clapFailed" : "recorder.measureFailed")}</span> : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {micRefused ? (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={arm} data-testid="stem-record-allow">
          <Mic />
          {t("recorder.allowMicrophone")}
        </Button>
      ) : null}
      {engine.tracks.some((track) => track.id === TAKE_ID) && phase === "recorded" ? <p className="text-xs text-muted-foreground">{t("recorder.takeHint")}</p> : null}
    </div>
  );
}
