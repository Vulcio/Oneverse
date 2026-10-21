import {
  encodeWav,
  hasSound,
  formatDuration,
  newMultitrackId,
  partKind,
  punchInAt,
  RECORDING_TIME_SIGNATURES,
  recordingPlan,
  spliceTake,
  TIME_SIGNATURE_PATTERN,
  type Attachment,
  type Multitrack,
  type RecordingDetails,
} from "@oneverse/core";
import { Circle, Hand, Headphones, Loader2, Mic, Play, RotateCcw, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { Input } from "@oneverse/ui/components/input";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { InputLevel } from "#/components/input-level";
import { PartPicker, usePartLabel, type PartChoice } from "#/components/part-picker";
import { apiClient } from "#/lib/api-client";
import { getMetronomeState, stopMetronome } from "#/lib/metronome-engine";
import { useMultitrackName } from "#/lib/multitrack-name";
import { Recorder, type Beat, type Take } from "#/lib/recorder";
import { pauseStems } from "#/lib/stem-engine";

/** A take can be this long at most: its WAV file stays under the upload limit for audio (50 MB). */
const MAX_BYTES = 50 * 1024 * 1024 - 1024;

/** The target that starts a new multitrack; an existing one is its id ("" for the original stems). */
export const NEW_TARGET = "new";

type Phase = "opening" | "ready" | "recording" | "recorded" | "saving";

/** What the take does once kept (issue #127): plays instead of another take (kept as another take), plays with the rest, or is kept aside. */
type Use = { kind: "instead"; id: string } | { kind: "with" } | { kind: "aside" };
const useValue = (use: Use) => (use.kind === "instead" ? `instead:${use.id}` : use.kind);
const useOf = (value: string): Use => (value.startsWith("instead:") ? { kind: "instead", id: value.slice(8) } : value === "aside" ? { kind: "aside" } : { kind: "with" });

/**
 * Records a part (issues #123, #127): into one of the song's multitracks,
 * hearing its other parts and the click, or into a new one with the
 * metronome only - the first layer of a song, or another version of it -
 * for a set, when recorded from its page. A take can replace one of the
 * part's (which is kept as another take), from a bar on if need be (a
 * punch-in); it's lined up with the rest (the device's delay taken off,
 * measured by loopback or by clapping along, a nudge to fine-tune it),
 * kept private until shared, and turned into Opus by the Worker.
 */
export function RecorderDialog({
  songVersionId,
  songTitle,
  multitracks,
  target: initialTarget,
  songTempo,
  songTimeSignature,
  songKey,
  setlist,
  onClose,
  onSaved,
}: {
  songVersionId: string;
  songTitle: string;
  /** The song's multitracks, to record into. */
  multitracks: Multitrack<Attachment>[];
  /** Where to start: a multitrack's id ("" for the original stems), or NEW_TARGET. */
  target: string;
  songTempo: number | null;
  /** "4/4", or "". */
  songTimeSignature: string;
  songKey: string;
  /** Recording from a set's song page: a new multitrack can be that set's. */
  setlist?: { id: string; name: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const nameOf = useMultitrackName();
  const recorder = useRef<Recorder | null>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("opening");
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState(initialTarget);
  const multitrack = target === NEW_TARGET ? null : (multitracks.find((candidate) => (candidate.id ?? "") === target) ?? null);
  const first = multitrack?.files[0];
  // The part: a voice by default - the first of the lead and harmonies not recorded yet (issue #131).
  const initialFiles = multitracks.find((candidate) => (candidate.id ?? "") === initialTarget)?.files ?? [];
  const firstFree = (["VOCALS", "HARMONY_SOPRANO", "HARMONY_ALTO", "HARMONY_TENOR", "HARMONY_BASS"] as const).find((voice) => !initialFiles.some((file) => file.stemPart === voice && !file.partName));
  const [choice, setChoice] = useState<PartChoice>({ stemPart: firstFree ?? "BACKING_VOCALS", partName: null });
  const part = choice.stemPart ?? "OTHER";
  const partLabel = usePartLabel();
  // A new multitrack's name, tempo and time signature, and its set; an existing one's are its own.
  const [name, setName] = useState("");
  const [tempo, setTempo] = useState(String(songTempo ?? 100));
  const [newSignature, setNewSignature] = useState(songTimeSignature || "4/4");
  const [forSet, setForSet] = useState(!!setlist);
  const [click, setClick] = useState(true);
  const [heard, setHeard] = useState<Set<string>>(new Set());
  const [loadingParts, setLoadingParts] = useState(false);
  const [use, setUse] = useState<Use>({ kind: "with" });
  const [fromBar, setFromBar] = useState("1");
  const [level, setLevel] = useState(true);
  const [noise, setNoise] = useState(false);
  // RNNoise, for a voice (issue #132).
  const [voiceCleanUp, setVoiceCleanUp] = useState(false);
  const isVoice = partKind(part) === "VOICE";
  const [roundTrip, setRoundTrip] = useState<{ seconds: number; measured: boolean } | null>(null);
  const [bluetooth, setBluetooth] = useState(false);
  const [calibrating, setCalibrating] = useState<"loopback" | "claps" | null>(null);
  const [clapBeat, setClapBeat] = useState(-1);
  const [calibrationFailed, setCalibrationFailed] = useState<"loopback" | "claps" | null>(null);
  const [zeroAt, setZeroAt] = useState(0);
  const [position, setPosition] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [nudge, setNudge] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [silent, setSilent] = useState(false);
  const previewRun = useRef(0);

  // The beat: an existing multitrack's own (or the song's), a new one's as set here.
  const tempoValue = multitrack ? (first?.recordingTempo ?? songTempo ?? NaN) : Number(tempo);
  const signature = multitrack ? (first?.recordingTimeSignature ?? (songTimeSignature || "4/4")) : newSignature;
  const signatureMatch = TIME_SIGNATURE_PATTERN.exec(signature);
  const beatsPerBar = signatureMatch ? Number(signatureMatch[1]) : 4;
  const plan = tempoValue >= 20 && tempoValue <= 400 ? recordingPlan({ tempo: tempoValue, beatsPerBar, firstBeat: multitrack ? (first?.recordingFirstBeat ?? 0) : null }) : null;
  const beat: Beat | null = plan ? { tempo: tempoValue, beatsPerBar, firstBeat: plan.firstBeat } : null;
  const valid = multitrack ? true : tempoValue >= 20 && tempoValue <= 400 && !!signatureMatch;
  // A punch-in: from a bar of an existing multitrack (bar 1 is its start).
  const bar = Math.max(1, Math.floor(Number(fromBar)) || 1);
  const punch = multitrack && beat ? punchInAt({ ...beat, fromBar: bar }) : { from: 0, lead: plan?.lead ?? 0 };
  // The take it replaces isn't heard from where it's replaced (from its start, without a punch-in).
  const stopAt = use.kind === "instead" ? new Map([[use.id, punch.from]]) : undefined;
  // The same part, already in the multitrack, that this take could replace.
  const samePart = multitrack?.files.filter((file) => file.stemPart === part && (file.partName ?? null) === (choice.partName ?? null) && file.canChange && !file.locked) ?? [];

  // Asks for the microphone: as the dialog opens, and again from a tap if that was refused
  // (an iPhone's home screen app asks only from a tap).
  const closed = useRef(false);
  const [micRefused, setMicRefused] = useState(false);
  // The recorder once it's open, for the microphone's level (issue #141).
  const [opened, setOpened] = useState<Recorder | null>(null);
  function openMicrophone() {
    setError(null);
    setMicRefused(false);
    Recorder.open()
      .then(async (opened) => {
        if (closed.current) return opened.close();
        recorder.current = opened;
        setOpened(opened);
        setRoundTrip(opened.roundTrip());
        setBluetooth((await opened.bluetoothOutput()) || opened.context.outputLatency > 0.1);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (closed.current) return;
        const refused = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
        setMicRefused(refused);
        setError(refused ? t("recorder.noMicrophone") : t("recorder.cantOpen"));
      });
  }
  useEffect(() => {
    closed.current = false;
    // Nothing else plays over the take.
    pauseStems();
    if (getMetronomeState().playing && !getMetronomeState().following) stopMetronome();
    openMicrophone();
    return () => {
      closed.current = true;
      recorder.current?.close();
      recorder.current = null;
    };
  }, []);

  // The multitrack's parts, to hear while recording (and a take to punch into).
  useEffect(() => {
    const current = recorder.current;
    if (!ready || !current) return;
    let stale = false;
    setPhase("opening");
    setLoadingParts(true);
    setTake(null);
    const files = multitrack?.files ?? [];
    void Promise.all(files.map(async (file) => ({ id: file.id, blob: await apiClient.downloadAttachment(songVersionId, file.id).catch(() => null) })))
      .then((loaded) => current.setBacking(loaded.filter((file): file is { id: string; blob: Blob } => file.blob !== null)))
      .then(() => {
        if (stale) return;
        setHeard(new Set(current.backingIds));
        setLoadingParts(false);
        setPhase("ready");
      });
    return () => {
      stale = true;
    };
  }, [ready, target]);

  // Replacing the part's take by default, when there's one of it to replace.
  useEffect(() => {
    setUse(samePart[0] ? { kind: "instead", id: samePart[0].id } : { kind: "with" });
  }, [target, part, choice.partName]);

  // The time while recording, and the limit.
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      const current = recorder.current;
      if (!current) return;
      const at = current.positionOf(zeroAt);
      setPosition(at);
      if (at * current.context.sampleRate * 2 > MAX_BYTES) void stop();
    }, 100);
    return () => clearInterval(timer);
  }, [phase, zeroAt]);

  function start() {
    const current = recorder.current;
    if (!current || !valid) return;
    setError(null);
    setTake(null);
    setNudge(0);
    setPreviewing(false);
    setPosition(punch.from - punch.lead);
    setZeroAt(current.start({ beat, lead: punch.lead, from: punch.from, click, heard, stopAt }));
    setPhase("recording");
  }

  async function stop() {
    const current = recorder.current;
    if (!current) return;
    const done = await current.finish(zeroAt);
    setTake(done);
    setPhase("recorded");
    // Nothing from the microphone (issue #134): said so, and nothing to keep.
    const nothing = !hasSound(done.captured, done.sampleRate);
    setSilent(nothing);
    setError(nothing ? t("recorder.silent") : null);
  }

  /** The take as it will be kept: lined up (nudged), and spliced into the take it replaces from the punch-in on. */
  function result(current: Recorder, done: Take): Float32Array {
    const aligned = current.aligned(done, current.roundTrip().seconds + nudge / 1000);
    const replaced = use.kind === "instead" && punch.from > 0 ? current.monoOf(use.id) : null;
    if (replaced) return spliceTake(replaced, aligned, Math.round(punch.from * done.sampleRate));
    // Before a punch-in with nothing to splice into: silence.
    if (punch.from > 0) aligned.fill(0, 0, Math.min(aligned.length, Math.round(punch.from * done.sampleRate)));
    return aligned;
  }

  function preview() {
    const current = recorder.current;
    if (!current || !take) return;
    current.stopPlaying();
    if (previewing) return setPreviewing(false);
    const samples = result(current, take);
    // From a little before the punch-in; the take it replaces is in the result.
    const from = Math.max(0, punch.from - punch.lead);
    const replaced = use.kind === "instead" ? new Map([[use.id, 0]]) : undefined;
    current.preview(samples, { beat, click, heard, nudge: 0, from, stopAt: replaced });
    setPreviewing(true);
    const run = ++previewRun.current;
    setTimeout(() => {
      if (previewRun.current === run) setPreviewing(false);
    }, (samples.length / take.sampleRate - from + 0.5) * 1000);
  }

  async function calibrate(method: "loopback" | "claps") {
    const current = recorder.current;
    if (!current) return;
    setCalibrating(method);
    setCalibrationFailed(null);
    const measured = method === "loopback" ? await current.calibrate() : await current.calibrateByClapping(setClapBeat);
    setCalibrating(null);
    setClapBeat(-1);
    if (measured === null) setCalibrationFailed(method);
    setRoundTrip(current.roundTrip());
  }

  async function keep() {
    const current = recorder.current;
    if (!current || !take) return;
    current.stopPlaying();
    setPreviewing(false);
    setPhase("saving");
    setError(null);
    try {
      const wav = encodeWav(result(current, take), take.sampleRate);
      const file = new File([wav as Uint8Array<ArrayBuffer>], `${songTitle || t("recorder.recording")} - ${partLabel(choice)}.wav`, { type: "audio/wav" });
      // A new multitrack: what it was recorded in. An existing one: its own, shared by its parts.
      const details: RecordingDetails = multitrack
        ? {
            ...(multitrack.id ? { multitrackId: multitrack.id } : {}),
            ...(first?.multitrackName ? { multitrackName: first.multitrackName } : {}),
            ...(first?.recordingKey ? { recordingKey: first.recordingKey } : {}),
            ...(first?.recordingTempo != null ? { recordingTempo: first.recordingTempo } : {}),
            ...(first?.recordingTimeSignature ? { recordingTimeSignature: first.recordingTimeSignature } : {}),
            ...(first?.recordingFirstBeat != null ? { recordingFirstBeat: first.recordingFirstBeat } : {}),
            ...(first?.recordingFreeIntro ? { recordingFreeIntro: true } : {}),
            ...(multitrack.setlistId ? { multitrackSetlistId: multitrack.setlistId } : {}),
          }
        : {
            multitrackId: newMultitrackId(),
            ...(name.trim() ? { multitrackName: name.trim() } : {}),
            recordingTempo: tempoValue,
            recordingTimeSignature: signature,
            recordingFirstBeat: plan?.firstBeat ?? 0,
            ...(setlist && forSet ? { multitrackSetlistId: setlist.id } : {}),
          };
      details.process = ["encode", isVoice && voiceCleanUp ? "voice" : null, level ? "level" : null, noise ? "noise" : null].filter(Boolean).join(",");
      if (choice.partName) details.partName = choice.partName;
      if (use.kind === "aside") details.otherTake = true;
      const saved = await apiClient.uploadAttachment(songVersionId, "AUDIO", file, part, { visibility: "PRIVATE" }, details);
      if (use.kind === "instead") await apiClient.useTake(songVersionId, saved.id, use.id);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("recorded");
    }
  }

  const busy = phase === "opening" || phase === "recording" || phase === "saving" || calibrating !== null;
  // The parts that could be decoded, to hear or not.
  const backing = loadingParts ? [] : (multitrack?.files.filter((file) => recorder.current?.backingIds.includes(file.id)) ?? []);
  const fileName = (file: Attachment) => file.filename.replace(/\.[a-z0-9]+$/i, "");

  return (
    <Dialog open onOpenChange={(open) => !open && phase !== "saving" && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="recorder" data-phase={phase}>
        <DialogHeader>
          <DialogTitle>{t("recorder.title")}</DialogTitle>
          <DialogDescription>{multitrack ? t("recorder.descriptionInto") : t("recorder.descriptionNew")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="w-28 shrink-0">{t("recorder.into")}</span>
            <NativeSelect value={target} disabled={busy && phase !== "opening"} onChange={(event) => setTarget(event.target.value)} data-testid="recorder-target">
              {multitracks.map((candidate, index) => (
                <option key={candidate.id ?? ""} value={candidate.id ?? ""}>
                  {nameOf(candidate, index)}
                </option>
              ))}
              <option value={NEW_TARGET}>{t("stems.newMultitrack")}</option>
            </NativeSelect>
          </label>
          <div className="flex items-start gap-2">
            <span className="mt-2 w-28 shrink-0">{t("recorder.part")}</span>
            {/* A voice, an instrument or the cues, then which (issue #131). */}
            <PartPicker value={choice} disabled={busy} label={t("recorder.part")} onChange={(next) => setChoice({ stemPart: next.stemPart ?? "VOCALS", partName: next.partName })} />
          </div>
          {multitrack ? (
            <>
              <p className="text-xs text-muted-foreground" data-testid="recorder-beat">
                {[first?.recordingKey ?? (songKey || null), beat ? `${beat.tempo} BPM` : t("recorder.noTempo"), signature].filter(Boolean).join(" · ")}
              </p>
              {/* What the take does once kept (issue #127). */}
              <label className="flex items-center gap-2">
                <span className="w-28 shrink-0">{t("recorder.use")}</span>
                <NativeSelect value={useValue(use)} disabled={busy} onChange={(event) => setUse(useOf(event.target.value))} data-testid="recorder-use">
                  {samePart.map((file) => (
                    <option key={file.id} value={`instead:${file.id}`}>
                      {t("recorder.useInstead", { name: fileName(file) })}
                    </option>
                  ))}
                  <option value="with">{t("recorder.useWith")}</option>
                  <option value="aside">{t("recorder.useAside")}</option>
                </NativeSelect>
              </label>
              {beat ? (
                <label className="flex items-center gap-2">
                  <span className="w-28 shrink-0">{t("recorder.fromBar")}</span>
                  <Input type="number" min={1} step={1} value={fromBar} disabled={busy} className="w-20" onChange={(event) => setFromBar(event.target.value)} data-testid="recorder-from-bar" />
                  <span className="text-xs text-muted-foreground">{bar > 1 ? t("recorder.fromBarAt", { time: formatDuration(punch.from) }) : t("recorder.fromStart")}</span>
                </label>
              ) : null}
            </>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <span className="w-28 shrink-0">{t("recorder.name")}</span>
                <Input value={name} maxLength={60} disabled={busy} placeholder={t("recorder.namePlaceholder")} onChange={(event) => setName(event.target.value)} data-testid="recorder-name" />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 shrink-0">{t("recorder.tempo")}</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={20}
                  max={400}
                  step="any"
                  value={tempo}
                  disabled={busy}
                  className="w-24"
                  aria-label={t("recorder.tempo")}
                  onChange={(event) => setTempo(event.target.value)}
                  data-testid="recorder-tempo"
                />
                <NativeSelect value={newSignature} disabled={busy} aria-label={t("recorder.timeSignature")} onChange={(event) => setNewSignature(event.target.value)} data-testid="recorder-signature">
                  {RECORDING_TIME_SIGNATURES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {setlist ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={forSet} disabled={busy} onChange={(event) => setForSet(event.target.checked)} data-testid="recorder-for-set" />
                  {t("recorder.forSet", { name: setlist.name })}
                </label>
              ) : null}
            </>
          )}
          {backing.length > 0 ? (
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <legend className="mb-1 text-xs text-muted-foreground">{t("recorder.hear")}</legend>
              {backing.map((file) => (
                <label key={file.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={heard.has(file.id)}
                    disabled={busy}
                    onChange={(event) => {
                      const next = new Set(heard);
                      if (event.target.checked) next.add(file.id);
                      else next.delete(file.id);
                      setHeard(next);
                    }}
                  />
                  {file.stemPart ? partLabel(file) : file.filename}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={click} disabled={busy || !beat} onChange={(event) => setClick(event.target.checked)} data-testid="recorder-click" />
              {t("recorder.click")}
            </label>
            {/* Done by the Worker once kept (issue #127). */}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={level} disabled={phase === "saving"} onChange={(event) => setLevel(event.target.checked)} data-testid="recorder-level" />
              {t("recorder.level")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={noise} disabled={phase === "saving"} onChange={(event) => setNoise(event.target.checked)} data-testid="recorder-noise" />
              {t("recorder.noise")}
            </label>
            {isVoice ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={voiceCleanUp} disabled={phase === "saving"} onChange={(event) => setVoiceCleanUp(event.target.checked)} data-testid="recorder-voice" />
                {t("recorder.voiceCleanUp")}
              </label>
            ) : null}
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Headphones className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("recorder.headphones")}
          </p>
          {bluetooth ? (
            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400" data-testid="recorder-bluetooth">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("recorder.bluetooth")}
            </p>
          ) : null}
          {roundTrip ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="recorder-latency">
              <span className="w-full">{t(roundTrip.measured ? "recorder.delayMeasured" : "recorder.delayEstimated", { ms: Math.round(roundTrip.seconds * 1000) })}</span>
              <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={busy} onClick={() => void calibrate("claps")} data-testid="recorder-clap">
                <Hand />
                {t("recorder.clapAlong")}
              </Button>
              <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={busy} onClick={() => void calibrate("loopback")} data-testid="recorder-calibrate">
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

          {/* What the microphone hears, before a take and during it: loud enough? */}
          {phase === "ready" || phase === "recording" ? <InputLevel recorder={opened} /> : null}
          {phase === "recording" ? (
            <p className="flex items-center gap-2 font-medium" role="status" data-testid="recorder-status">
              <Circle className="size-3 animate-pulse fill-destructive text-destructive" aria-hidden />
              {position < Math.max(punch.from, multitrack ? 0 : (plan?.firstBeat ?? 0)) ? t("recorder.countIn") : t("recorder.recordingAt", { time: formatDuration(position) })}
            </p>
          ) : null}
          {take && (phase === "recorded" || phase === "saving") ? (
            <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="recorder-take">
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={preview} disabled={phase === "saving"} data-testid="recorder-preview">
                  {previewing ? <Square /> : <Play />}
                  {previewing ? t("recorder.stopPreview") : t("recorder.preview")}
                </Button>
                <span className="text-xs text-muted-foreground">{formatDuration(Math.max(0, take.captured.length / take.sampleRate - punch.lead - 0.2))}</span>
              </div>
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
                  onChange={(event) => {
                    setNudge(Number(event.target.value));
                    if (previewing) {
                      recorder.current?.stopPlaying();
                      setPreviewing(false);
                    }
                  }}
                  aria-label={t("recorder.nudge")}
                  data-testid="recorder-nudge"
                />
                <span className="w-16 shrink-0 text-right tabular-nums">{t("recorder.nudgeMs", { ms: nudge > 0 ? `+${nudge}` : nudge })}</span>
              </label>
              <p className="text-xs text-muted-foreground">{t("recorder.nudgeHint")}</p>
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {micRefused ? (
            <Button type="button" variant="outline" className="self-start" onClick={openMicrophone} data-testid="recorder-allow">
              <Mic />
              {t("recorder.allowMicrophone")}
            </Button>
          ) : null}
        </div>

        <DialogFooter>
          {phase === "recording" ? (
            <Button type="button" variant="destructive" onClick={() => void stop()} data-testid="recorder-stop">
              <Square />
              {t("recorder.stop")}
            </Button>
          ) : take && (phase === "recorded" || phase === "saving") ? (
            <>
              <Button type="button" variant="outline" onClick={start} disabled={phase === "saving"} data-testid="recorder-again">
                <RotateCcw />
                {t("recorder.again")}
              </Button>
              <Button type="button" onClick={() => void keep()} disabled={phase === "saving" || silent} data-testid="recorder-keep">
                {phase === "saving" ? <Loader2 className="animate-spin" /> : null}
                {phase === "saving" ? t("recorder.saving") : t("recorder.keep")}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={start} disabled={phase !== "ready" || !valid || calibrating !== null} data-testid="recorder-start">
              {phase === "opening" && !error ? <Loader2 className="animate-spin" /> : <Circle className="fill-current" />}
              {t("recorder.record")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
