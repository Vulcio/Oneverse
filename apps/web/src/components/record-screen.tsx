import {
  alignTake,
  encodeWav,
  formatDuration,
  hasSound,
  mergeTake,
  newMultitrackId,
  partKind,
  punchInAt,
  RECORDING_TIME_SIGNATURES,
  recordingPlan,
  sortedCues,
  TIME_SIGNATURE_PATTERN,
  patternFor,
  type Attachment,
  type BeatLevel,
  type CueSection,
  type Multitrack,
  type RecordingDetails,
} from "@oneverse/core";
import { useRouteContext } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronUp, Circle, CloudOff, Hand, Headphones, ListPlus, Loader2, Mic, Play, RotateCcw, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Drawer, DrawerContent, DrawerTitle } from "@oneverse/ui/components/drawer";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Tabs, TabsList, TabsTrigger } from "@oneverse/ui/components/tabs";
import { cn } from "@oneverse/ui/lib/utils";
import { InputLevel, LevelLine } from "#/components/input-level";
import { PartPicker, usePartLabel, type PartChoice } from "#/components/part-picker";
import { useCueNames } from "#/components/stem-cues";
import { TakeStrip } from "#/components/take-strip";
import { apiClient } from "#/lib/api-client";
import { getMetronomeState, ownMetronomeSettings, stopMetronome } from "#/lib/metronome-engine";
import { useMultitrackName } from "#/lib/multitrack-name";
import { openOwnEngine, openPlayerEngine, type RecordEngine } from "#/lib/record-engine";
import type { Beat, Take } from "#/lib/recorder";
import { getStemState, pauseStems, type StemSong } from "#/lib/stem-engine";
import { keepTake, TakeLog, type TakeTarget } from "#/lib/take-store";

/** A take can be this long at most: its WAV file stays under the upload limit for audio (50 MB). */
const MAX_BYTES = 50 * 1024 * 1024 - 1024;
/** A section's take goes on this long past its end, then stops: its last note rings out (and is faded into what follows). */
const TAIL = 0.4;

/** The target that starts a new multitrack; an existing one is its id ("" for the original stems). */
export const NEW_TARGET = "new";

type Phase = "opening" | "ready" | "recording" | "saving" | "waiting";

/** What the take does once kept (issue #127): plays instead of another take (kept as another take), plays with the rest, or is kept aside. */
type Use = { kind: "instead"; id: string } | { kind: "with" } | { kind: "aside" };
const useValue = (use: Use) => (use.kind === "instead" ? `instead:${use.id}` : use.kind);
const useOf = (value: string): Use => (value.startsWith("instead:") ? { kind: "instead", id: value.slice(8) } : value === "aside" ? { kind: "aside" } : { kind: "with" });

/** What's recorded: the whole song, one of its sections (from the cue points), or from a bar on. */
type What = "song" | "section" | "bar";

/** A take recorded in this screen, kept to compare with the others until one is kept. */
interface RecordedTake {
  number: number;
  take: Take;
  /** The time it covers in the multitrack: from, and up to (null: to where it stopped). */
  from: number;
  to: number | null;
  /** Its own name for the range ("Chorus", "From bar 5"); null for the whole song. */
  range: string | null;
  log: TakeLog | null;
  silent: boolean;
  nudge: number;
}

/**
 * The recording screen (issue #365): one screen to record a part, the same
 * from a song's page, from Practice and from the stem player. Into one of
 * the song's multitracks (hearing its other parts and the click) or a new
 * one (the metronome only); the whole song, a section from its cue points,
 * or from a bar on - with a count-in, the music before it heard, and the
 * part it replaces kept either side (punched in and out). Each take is kept
 * to listen to and compare; Record again in one tap; the one picked is
 * lined up (the device's delay, a nudge) and kept - on the device first,
 * until it's uploaded. Sections can be recorded one after the other into
 * one part (issue #141). From the player, it records over the player's own
 * mix and clock (issue #134); elsewhere on a context of its own.
 */
export function RecordScreen({
  songVersionId,
  songTitle,
  multitracks,
  target: initialTarget,
  into = null,
  songTempo,
  songTimeSignature,
  songBeats = null,
  songKey,
  setlist,
  cueSections = [],
  player = null,
  inline = false,
  onPhase,
  onClose,
  onSaved,
}: {
  songVersionId: string;
  songTitle: string;
  /** The song's multitracks, to record into. */
  multitracks: Multitrack<Attachment>[];
  /** Where to start: a multitrack's id ("" for the original stems), or NEW_TARGET. */
  target: string;
  /** A part to record into (issue #142): chosen as the part, and as the take it replaces. */
  into?: string | null;
  songTempo: number | null;
  /** "4/4", or "". */
  songTimeSignature: string;
  /** The version's own metronome pattern (issue #384); null: the player's. */
  songBeats?: BeatLevel[] | null;
  songKey: string;
  /** Recording from a set's song page: a new multitrack can be that set's. */
  setlist?: { id: string; name: string } | null;
  /** The song's sections, to name the cue points. */
  cueSections?: CueSection[];
  /** Opened from the stem player: records over its mix when it's this multitrack. */
  player?: StemSong | null;
  onClose: () => void;
  onSaved: () => void;
  /** In the player (issue #365): a part of it, not a drawer of its own - the player's tracks stay in reach. */
  inline?: boolean;
  /** Hears whether a take is being recorded: the player's Record tab says so. */
  onPhase?: (phase: "opening" | "ready" | "recording" | "saving" | "waiting") => void;
}) {
  const { t } = useTranslation();
  const { session } = useRouteContext({ from: "/_protected" });
  const nameOf = useMultitrackName();
  const partLabel = usePartLabel();
  const cueNames = useCueNames();
  const engine = useRef<RecordEngine | null>(null);
  const [opened, setOpened] = useState<RecordEngine | null>(null);
  const [phase, setPhase] = useState<Phase>("opening");
  useEffect(() => onPhase?.(phase), [phase]);
  const [error, setError] = useState<string | null>(null);
  const [micRefused, setMicRefused] = useState(false);
  const [target, setTarget] = useState(initialTarget);
  const multitrack = target === NEW_TARGET ? null : (multitracks.find((candidate) => (candidate.id ?? "") === target) ?? null);
  const first = multitrack?.files[0];
  const onPlayer = !!player && !!multitrack && (player.multitrackId ?? "") === (multitrack.id ?? "");

  // The part: the one recorded into, else a voice - the first of the lead and harmonies not there yet (issue #131).
  const intoFile = into ? multitrack?.files.find((file) => file.id === into) : undefined;
  const initialFiles = multitracks.find((candidate) => (candidate.id ?? "") === initialTarget)?.files ?? [];
  const firstFree = (["VOCALS", "HARMONY_SOPRANO", "HARMONY_ALTO", "HARMONY_TENOR", "HARMONY_BASS"] as const).find((voice) => !initialFiles.some((file) => file.stemPart === voice && !file.partName));
  const [choice, setChoice] = useState<PartChoice>(
    intoFile?.stemPart ? { stemPart: intoFile.stemPart, partName: intoFile.partName ?? null } : { stemPart: firstFree ?? "BACKING_VOCALS", partName: null },
  );
  const part = choice.stemPart ?? "OTHER";
  const isVoice = partKind(part) === "VOICE";
  // The same part, already in the multitrack, that this take could replace.
  const samePart = multitrack?.files.filter((file) => file.stemPart === part && (file.partName ?? null) === (choice.partName ?? null) && file.canChange && !file.locked) ?? [];
  const [use, setUse] = useState<Use>({ kind: "with" });
  useEffect(() => {
    const replaced = samePart.find((file) => file.id === into) ?? samePart[0];
    setUse(replaced ? { kind: "instead", id: replaced.id } : { kind: "with" });
  }, [target, part, choice.partName]);
  const replace = use.kind === "instead" ? use.id : null;

  // A new multitrack's name, tempo and time signature, and its set; an existing one's are its own.
  const [name, setName] = useState("");
  const [tempo, setTempo] = useState(String(songTempo ?? 100));
  const [newSignature, setNewSignature] = useState(songTimeSignature || "4/4");
  const [forSet, setForSet] = useState(!!setlist);
  const freshMultitrack = useRef(newMultitrackId());
  const tempoValue = multitrack ? (first?.recordingTempo ?? songTempo ?? NaN) : Number(tempo);
  const signature = multitrack ? (first?.recordingTimeSignature ?? (songTimeSignature || "4/4")) : newSignature;
  const signatureMatch = TIME_SIGNATURE_PATTERN.exec(signature);
  const beatsPerBar = signatureMatch ? Number(signatureMatch[1]) : 4;
  const hasTempo = tempoValue >= 20 && tempoValue <= 400;
  const plan = hasTempo
    ? recordingPlan({
        tempo: tempoValue,
        beatsPerBar,
        firstBeat: multitrack ? (first?.recordingFirstBeat ?? 0) : null,
      })
    : null;
  // The click sounds the metronome's pattern for the bar (issue #384): the version's, else the player's.
  const levels = signatureMatch
    ? songBeats?.length === beatsPerBar && signature === (songTimeSignature || "4/4")
      ? songBeats
      : patternFor(ownMetronomeSettings(), { numerator: beatsPerBar, denominator: Number(signatureMatch[2]) })
    : undefined;
  const beat: Beat | null = plan ? { tempo: tempoValue, beatsPerBar, firstBeat: plan.firstBeat, levels } : null;
  const barLength = beat ? (60 / beat.tempo) * beat.beatsPerBar : 2;
  const valid = multitrack ? true : hasTempo && !!signatureMatch;

  // What's recorded: the whole song, a section, or from a bar.
  const cues = sortedCues(multitrack?.files.find((file) => file.cuePoints?.length)?.cuePoints, cueSections);
  const [what, setWhat] = useState<What>("song");
  const [cueIndex, setCueIndex] = useState(0);
  const [fromBar, setFromBar] = useState("1");
  const bar = Math.max(1, Math.floor(Number(fromBar)) || 1);
  const cue = cues[cueIndex];
  // From the player: from the bar its playhead is in (issue #134), as the small panel did.
  useEffect(() => {
    if (!onPlayer || !beat) return;
    const at = getStemState().position;
    const from = Math.floor((at - beat.firstBeat) / barLength) + 1;
    if (from > 1) {
      setWhat("bar");
      setFromBar(String(from));
    }
  }, []);
  const cueSection = cue ? cueSections.find((section) => section.id === cue.sectionId) : undefined;
  const range: {
    from: number;
    to: number | null;
    lead: number;
    label: string | null;
  } = !multitrack
    ? { from: 0, to: null, lead: plan?.lead ?? 0, label: null }
    : what === "section" && cue
      ? {
          from: cue.at,
          to: cues[cueIndex + 1]?.at ?? null,
          lead: cue.at > 0 ? barLength : 0,
          label: cueSection ? cueNames.long(cueSection) : null,
        }
      : what === "bar" && beat
        ? {
            ...punchInAt({ ...beat, fromBar: bar }),
            to: null,
            label: bar > 1 ? t("recorder.screen.fromBarLabel", { bar }) : null,
          }
        : {
            from: 0,
            to: null,
            lead: beat ? punchInAt({ ...beat, fromBar: 1 }).lead : 0,
            label: null,
          };

  const [click, setClick] = useState(true);
  const [heard, setHeard] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState(true);
  const [noise, setNoise] = useState(false);
  const [voiceCleanUp, setVoiceCleanUp] = useState(false);
  const [roundTrip, setRoundTrip] = useState<{
    seconds: number;
    measured: boolean;
  } | null>(null);
  const [bluetooth, setBluetooth] = useState(false);
  const [calibrating, setCalibrating] = useState<"loopback" | "claps" | null>(null);
  const [clapBeat, setClapBeat] = useState(-1);
  const [calibrationFailed, setCalibrationFailed] = useState<"loopback" | "claps" | null>(null);
  const [interrupted, setInterrupted] = useState<"device" | "suspended" | null>(null);
  // The sound now goes elsewhere (its name): said once, with its delay.
  const [routeChanged, setRouteChanged] = useState<string | null>(null);

  // The take being recorded, and those recorded so far (newest last); the one picked to keep.
  const zeroAt = useRef(0);
  const recording = useRef<{
    from: number;
    to: number | null;
    label: string | null;
    log: TakeLog | null;
  } | null>(null);
  const [position, setPosition] = useState(0);
  const [takes, setTakes] = useState<RecordedTake[]>([]);
  const takesRef = useRef<RecordedTake[]>([]);
  takesRef.current = takes;
  const [picked, setPicked] = useState<number | null>(null);
  const counter = useRef(0);
  const [listening, setListening] = useState<number | "rest" | null>(null);
  // Sections kept so far, merged into one part (issue #141): what the next one goes into.
  const sections = useRef<Float32Array | null>(null);
  const [sectionCount, setSectionCount] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  // All the choices, or only the take (the song behind stays in view): pulled down once recording starts.
  const [more, setMore] = useState(true);
  const closed = useRef(false);

  /** Opens the microphone, and what plays with it: the player's clock, or one of its own with the multitrack's parts. */
  function open(next: string = target) {
    setError(null);
    setMicRefused(false);
    setPhase("opening");
    engine.current?.close();
    engine.current = null;
    setOpened(null);
    const nextMultitrack = next === NEW_TARGET ? null : (multitracks.find((candidate) => (candidate.id ?? "") === next) ?? null);
    const withPlayer = !!player && !!nextMultitrack && (player.multitrackId ?? "") === (nextMultitrack.id ?? "");
    (withPlayer && player ? openPlayerEngine(player) : openOwnEngine(songVersionId, nextMultitrack?.files ?? []))
      .then(async (ready) => {
        if (closed.current) return ready.close();
        engine.current = ready;
        setOpened(ready);
        ready.recorder.onInterrupted = (reason) => setInterrupted(reason);
        // Headphones plugged in, Bluetooth connected (issue #365): that route's own delay, or measure it.
        ready.recorder.onRouteChanged = (output) => {
          setRoundTrip(ready.recorder.roundTrip());
          setRouteChanged(output || t("recorder.screen.otherOutput"));
          void ready.recorder.bluetoothOutput().then((yes) => setBluetooth(yes || ready.recorder.context.outputLatency > 0.1));
        };
        ready.recorder.onBlock = (frame, data) => recording.current?.log?.add(frame, data);
        setHeard(new Set(ready.parts.map((file) => file.id)));
        setRoundTrip(ready.recorder.roundTrip());
        setBluetooth((await ready.recorder.bluetoothOutput()) || ready.recorder.context.outputLatency > 0.1);
        setPhase("ready");
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
    // Nothing else plays over the take; the player, when it's recorded over, is started by the take.
    if (!onPlayer) pauseStems();
    if (getMetronomeState().playing && !getMetronomeState().following) stopMetronome();
    open();
    return () => {
      closed.current = true;
      engine.current?.close();
      engine.current = null;
      // Closed without keeping them: the takes go (one kept was already handed over).
      for (const take of takesRef.current) void take.log?.drop();
      void recording.current?.log?.drop();
    };
  }, []);

  /** Another multitrack: its parts to hear, its clock. Takes so far were of the other one. */
  function changeTarget(next: string) {
    for (const take of takes) void take.log?.drop();
    setTakes([]);
    setPicked(null);
    sections.current = null;
    setSectionCount(0);
    setWhat("song");
    setTarget(next);
    open(next);
  }

  /** What the take is, to keep it on the device and upload it. */
  function takeTarget(): TakeTarget {
    return {
      userId: session.userId,
      songVersionId,
      songTitle,
      name: `${songTitle || t("recorder.recording")} - ${partLabel(choice)}`,
      part,
      details: details(),
      instead: replace,
    };
  }

  /** What the take was recorded in: a new multitrack's, or the existing one's own, shared by its parts. */
  function details(): RecordingDetails {
    const result: RecordingDetails = multitrack
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
          multitrackId: freshMultitrack.current,
          ...(name.trim() ? { multitrackName: name.trim() } : {}),
          recordingTempo: tempoValue,
          recordingTimeSignature: signature,
          recordingFirstBeat: plan?.firstBeat ?? 0,
          ...(setlist && forSet ? { multitrackSetlistId: setlist.id } : {}),
        };
    // Sung while the player was transposed (issue #135): that far above the multitrack.
    if (onPlayer && player?.transpose) result.pitchOffset = player.transpose;
    result.process = ["encode", isVoice && voiceCleanUp ? "voice" : null, level ? "level" : null, noise ? "noise" : null].filter(Boolean).join(",");
    if (choice.partName) result.partName = choice.partName;
    if (use.kind === "aside") result.otherTake = true;
    return result;
  }

  async function start() {
    const current = engine.current;
    if (!current || !valid || phase !== "ready") return;
    current.stopPlaying();
    setListening(null);
    setError(null);
    setInterrupted(null);
    const { from, to, lead, label } = range;
    recording.current = { from, to, label, log: null };
    setPosition(from - lead);
    setMore(false);
    setPhase("recording");
    const at = await current.start({ from, lead, beat, click, heard, replace });
    zeroAt.current = at;
    // Written to the device as it comes in (issue #365); blocks before this are in the recorder's own memory.
    if (recording.current)
      recording.current.log = TakeLog.begin(takeTarget(), {
        sampleRate: current.recorder.context.sampleRate,
        zeroAt: at,
        delay: current.recorder.roundTrip().seconds,
        from,
      });
  }

  const stopping = useRef(false);
  async function stop() {
    const current = engine.current;
    const now = recording.current;
    if (!current || !now || stopping.current) return;
    stopping.current = true;
    try {
      const done = await current.stop(zeroAt.current);
      await now.log?.finish();
      recording.current = null;
      const silent = !hasSound(done.captured, done.sampleRate);
      const number = ++counter.current;
      setTakes((list) => [
        ...list,
        {
          number,
          take: done,
          from: now.from,
          to: now.to,
          range: now.label,
          log: now.log,
          silent,
          nudge: 0,
        },
      ]);
      // The newest is the one picked, unless it's silent.
      if (!silent) setPicked(number);
      setError(silent ? t("recorder.silent") : null);
      setPhase("ready");
    } finally {
      stopping.current = false;
    }
  }

  // The time while recording; the end of a section, and the size limit, stop it.
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      const current = engine.current;
      const now = recording.current;
      if (!current || !now) return;
      const at = current.position(zeroAt.current);
      setPosition(at);
      const ended = now.to !== null && at >= now.to + TAIL;
      const tooLong = (at - now.from) * current.recorder.context.sampleRate * 2 > MAX_BYTES;
      if (ended || tooLong || (current.kind === "player" && zeroAt.current > 0 && !current.playing())) void stop();
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);

  // Stopped by the device: what was recorded is kept, and said why.
  useEffect(() => {
    if (interrupted && phase === "recording") void stop();
  }, [interrupted]);

  /** A take as it will be kept: lined up (nudged), cut at its section's end, into the sections kept so far or the part it replaces - kept either side. */
  function result(recorded: RecordedTake): Float32Array {
    const current = engine.current;
    const { take } = recorded;
    const delay = (current?.recorder.roundTrip().seconds ?? 0) + recorded.nudge / 1000;
    let aligned = alignTake(take.captured, {
      sampleRate: take.sampleRate,
      capturedAt: take.capturedAt,
      zeroAt: take.zeroAt,
      delay,
    });
    if (recorded.to !== null) aligned = aligned.subarray(0, Math.min(aligned.length, Math.round((recorded.to + TAIL / 2) * take.sampleRate)));
    const base = sections.current ?? (replace && current ? current.base(replace) : null);
    if (!base && recorded.from === 0) return aligned;
    return mergeTake(base, aligned, Math.round(recorded.from * take.sampleRate));
  }

  async function listen(recorded: RecordedTake | null) {
    const current = engine.current;
    if (!current) return;
    const key = recorded?.number ?? "rest";
    if (listening === key) {
      current.stopPlaying();
      return setListening(null);
    }
    const samples = recorded ? result(recorded) : sections.current;
    const from = Math.max(0, (recorded?.from ?? range.from) - (recorded && recorded.from > 0 ? barLength : 0));
    await current.play(samples, {
      from,
      beat,
      click,
      heard,
      replace: samples ? replace : null,
      name: t("recorder.newTake", { part: partLabel(choice) }),
      part,
    });
    setListening(key);
  }

  // Back to "Listen" once what plays has ended.
  useEffect(() => {
    if (listening === null) return;
    const timer = setInterval(() => {
      if (!engine.current?.playing()) setListening(null);
    }, 250);
    return () => clearInterval(timer);
  }, [listening]);

  function nudge(number: number, value: number) {
    engine.current?.stopPlaying();
    setListening(null);
    setTakes((list) => list.map((item) => (item.number === number ? { ...item, nudge: value } : item)));
  }

  async function remove(number: number) {
    const gone = takes.find((item) => item.number === number);
    if (listening === number) engine.current?.stopPlaying();
    void gone?.log?.drop();
    const rest = takes.filter((item) => item.number !== number);
    setTakes(rest);
    if (picked === number) setPicked(rest.filter((item) => !item.silent).at(-1)?.number ?? null);
  }

  const chosen = takes.find((item) => item.number === picked && !item.silent) ?? null;

  /** The take picked goes into the sections kept (issue #141); the next section's to record. */
  function keepSection() {
    if (!chosen) return;
    engine.current?.stopPlaying();
    setListening(null);
    sections.current = result(chosen);
    setSectionCount((count) => count + 1);
    for (const item of takes) void item.log?.drop();
    setTakes([]);
    setPicked(null);
    if (what === "section" && cueIndex + 1 < cues.length) setCueIndex(cueIndex + 1);
  }

  async function calibrate(method: "loopback" | "claps") {
    const current = engine.current;
    if (!current) return;
    current.stopPlaying();
    setCalibrating(method);
    setCalibrationFailed(null);
    const measured = method === "loopback" ? await current.recorder.calibrate() : await current.recorder.calibrateByClapping(setClapBeat);
    setCalibrating(null);
    setClapBeat(-1);
    if (measured === null) setCalibrationFailed(method);
    else setRouteChanged(null);
    setRoundTrip(current.recorder.roundTrip());
  }

  async function keep() {
    const current = engine.current;
    const samples = chosen ? result(chosen) : sections.current;
    if (!current || !samples) return;
    current.stopPlaying();
    setListening(null);
    setPhase("saving");
    setError(null);
    try {
      const sampleRate = chosen?.take.sampleRate ?? current.recorder.context.sampleRate;
      const wav = new Blob([encodeWav(samples, sampleRate) as Uint8Array<ArrayBuffer>], { type: "audio/wav" });
      // Kept on the device first, then uploaded (issue #365): without a connection, it waits and goes on its own.
      const handed = chosen?.log ?? null;
      for (const item of takes) if (item !== chosen) void item.log?.drop();
      setTakes([]);
      const kept = await keepTake({ log: handed, target: takeTarget(), wav, sampleRate }, apiClient);
      if (kept.waiting) return setPhase("waiting");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    }
  }

  function close() {
    if (phase === "saving" || phase === "recording") return;
    if ((takes.some((item) => !item.silent) || sectionCount > 0) && !confirmClose) return setConfirmClose(true);
    onClose();
  }

  const busy = phase === "opening" || phase === "recording" || phase === "saving" || calibrating !== null;
  // Choices that shape the take: fixed once there are takes or sections, as they're compared (and merged) with one another.
  const settled = busy || takes.length > 0 || sectionCount > 0;
  const fileName = (file: Attachment) => file.partName || file.filename.replace(/\.[a-z0-9]+$/i, "");
  const counting = phase === "recording" && position < range.from;
  const beatsLeft = counting && beat ? Math.max(1, Math.ceil((range.from - position) / (60 / beat.tempo) - 1e-6)) : null;

  // The strip: what's heard with the take, from where the playhead is - the take's place, the player's, or where the next take starts.
  const aheadParts = opened?.ahead(heard, replace) ?? [];
  const stripPosition = () => {
    const current = engine.current;
    if (!current) return null;
    if (phase === "recording") return current.position(zeroAt.current);
    if (current.kind === "player" && getStemState().playing) return getStemState().position;
    return multitrack ? Math.max(0, range.from - range.lead) : null;
  };
  const stripMarks = cues.flatMap((item) => {
    const section = cueSections.find((candidate) => candidate.id === item.sectionId);
    return section ? [{ at: item.at, label: cueNames.short(section) }] : [];
  });

  return (
    <Shell
      inline={inline}
      onDismiss={close}
      label={t("recorder.title")}
      data-testid="recorder"
      data-phase={phase}
      data-engine={opened?.kind}
      data-more={more ? "true" : "false"}
    >
        <div className="flex items-center gap-2 px-4 pb-2">
          <Mic className={cn("size-4 shrink-0", phase === "recording" ? "text-destructive" : "text-muted-foreground")} aria-hidden />
          <Title inline={inline}>
            {[partLabel(choice), multitrack ? (range.label ?? (what === "song" ? t("recorder.screen.wholeSong") : null)) : t("stems.newMultitrack")].filter(Boolean).join(" · ")}
            <span className="font-normal text-muted-foreground"> · {songTitle}</span>
          </Title>
          {phase === "recording" ? (
            <span className="text-sm font-semibold text-destructive tabular-nums" role="status" data-testid="recorder-status">
              {counting
                ? beatsLeft
                  ? t("recorder.screen.countInBeats", { count: beatsLeft })
                  : t("recorder.countIn")
                : t("recorder.recordingAt", {
                    time: formatDuration(Math.max(0, position)),
                  })}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setMore(!more)}
            aria-expanded={more}
            aria-label={more ? t("recorder.screen.less") : t("recorder.screen.more")}
            data-testid="recorder-more"
          >
            {more ? <ChevronDown /> : <ChevronUp />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={close}
            disabled={phase === "saving" || phase === "recording"}
            aria-label={t("recorder.close")}
            data-testid="recorder-dismiss"
          >
            <X />
          </Button>
        </div>
        <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4", inline && "max-h-[45dvh] px-3")}>
          {/* The take as it's recorded: the microphone left of the playhead, the parts to come right of it. */}
          <TakeStrip recorder={opened?.recorder ?? null} ahead={aheadParts} position={stripPosition} marks={stripMarks} recording={phase === "recording" && !counting} />
          {/* The level in a line once the choices (and their meter) are folded away. */}
          {!more && (phase === "ready" || phase === "recording") ? <LevelLine recorder={opened?.recorder ?? null} className="-mt-2" /> : null}
          {more ? (
            <div className="flex flex-col gap-4">
              {/* Into what, and which part. */}
              <div className="grid gap-3 text-sm sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
                <Label htmlFor="recorder-target">{t("recorder.into")}</Label>
                <NativeSelect id="recorder-target" value={target} disabled={settled && phase !== "opening"} onChange={(event) => changeTarget(event.target.value)} data-testid="recorder-target">
                  {multitracks.map((candidate, index) => (
                    <option key={candidate.id ?? ""} value={candidate.id ?? ""}>
                      {nameOf(candidate, index)}
                    </option>
                  ))}
                  <option value={NEW_TARGET}>{t("stems.newMultitrack")}</option>
                </NativeSelect>
                <span className="self-start sm:mt-2">{t("recorder.part")}</span>
                {/* A voice, an instrument or the cues, then which (issue #131). */}
                <PartPicker
                  value={choice}
                  disabled={settled}
                  label={t("recorder.part")}
                  onChange={(next) =>
                    setChoice({
                      stemPart: next.stemPart ?? "VOCALS",
                      partName: next.partName,
                    })
                  }
                />
                {multitrack ? (
                  <>
                    <Label htmlFor="recorder-use">{t("recorder.use")}</Label>
                    <NativeSelect id="recorder-use" value={useValue(use)} disabled={settled} onChange={(event) => setUse(useOf(event.target.value))} data-testid="recorder-use">
                      {samePart.map((file) => (
                        <option key={file.id} value={`instead:${file.id}`}>
                          {t("recorder.useInstead", { name: fileName(file) })}
                        </option>
                      ))}
                      <option value="with">{t("recorder.useWith")}</option>
                      <option value="aside">{t("recorder.useAside")}</option>
                    </NativeSelect>
                  </>
                ) : (
                  <>
                    <Label htmlFor="recorder-name">{t("recorder.name")}</Label>
                    <Input
                      id="recorder-name"
                      value={name}
                      maxLength={60}
                      disabled={settled}
                      placeholder={t("recorder.namePlaceholder")}
                      onChange={(event) => setName(event.target.value)}
                      data-testid="recorder-name"
                    />
                    <Label htmlFor="recorder-tempo">{t("recorder.tempo")}</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        id="recorder-tempo"
                        type="number"
                        inputMode="decimal"
                        min={20}
                        max={400}
                        step="any"
                        value={tempo}
                        disabled={settled}
                        className="w-24"
                        onChange={(event) => setTempo(event.target.value)}
                        data-testid="recorder-tempo"
                      />
                      <NativeSelect
                        value={newSignature}
                        disabled={settled}
                        aria-label={t("recorder.timeSignature")}
                        onChange={(event) => setNewSignature(event.target.value)}
                        data-testid="recorder-signature"
                      >
                        {RECORDING_TIME_SIGNATURES.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    {setlist ? (
                      <label className="flex items-center gap-2 sm:col-start-2">
                        <input type="checkbox" checked={forSet} disabled={settled} onChange={(event) => setForSet(event.target.checked)} data-testid="recorder-for-set" />
                        {t("recorder.forSet", { name: setlist.name })}
                      </label>
                    ) : null}
                  </>
                )}
              </div>
              {multitrack ? (
                <p className="text-xs text-muted-foreground" data-testid="recorder-beat">
                  {[first?.recordingKey ?? (songKey || null), beat ? `${beat.tempo} BPM` : t("recorder.noTempo"), signature].filter(Boolean).join(" · ")}
                  {onPlayer ? ` · ${t("recorder.screen.overPlayer")}` : ""}
                </p>
              ) : null}

              {/* What to record: the whole song, a section, from a bar. */}
              {multitrack ? (
                <div className="flex flex-col gap-2" data-testid="recorder-what">
                  <Tabs value={what} onValueChange={(value) => setWhat(value as What)}>
                    <TabsList className="w-full" aria-label={t("recorder.screen.what")}>
                      <TabsTrigger value="song" disabled={busy || takes.length > 0} data-testid="recorder-what-song">
                        {t("recorder.screen.wholeSong")}
                      </TabsTrigger>
                      <TabsTrigger value="section" disabled={busy || takes.length > 0} data-testid="recorder-what-section">
                        {t("recorder.screen.section")}
                      </TabsTrigger>
                      <TabsTrigger value="bar" disabled={busy || takes.length > 0 || !beat} data-testid="recorder-what-bar">
                        {t("recorder.fromBar")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {what === "section" ? (
                    cues.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5" data-testid="recorder-sections">
                        {cues.map((item, index) => {
                          const section = cueSections.find((candidate) => candidate.id === item.sectionId);
                          return (
                            <Button
                              key={`${item.sectionId}-${item.at}`}
                              type="button"
                              size="sm"
                              variant={index === cueIndex ? "default" : "outline"}
                              className="h-8 rounded-full"
                              disabled={busy || takes.length > 0}
                              aria-pressed={index === cueIndex}
                              onClick={() => setCueIndex(index)}
                              data-testid="recorder-section"
                            >
                              {section
                                ? cueNames.long(section)
                                : t("recorder.screen.sectionN", {
                                    n: index + 1,
                                  })}
                              <span className="text-xs opacity-70 tabular-nums">{formatDuration(item.at)}</span>
                            </Button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("recorder.screen.noSections")}</p>
                    )
                  ) : what === "bar" ? (
                    <label className="flex items-center gap-2 text-sm">
                      <span className="shrink-0">{t("recorder.fromBar")}</span>
                      <Input type="number" min={1} step={1} value={fromBar} disabled={busy || takes.length > 0} className="w-20" onChange={(event) => setFromBar(event.target.value)} data-testid="recorder-from-bar" />
                      <span className="text-xs text-muted-foreground">
                        {bar > 1
                          ? t("recorder.fromBarAt", {
                              time: formatDuration(range.from),
                            })
                          : t("recorder.fromStart")}
                      </span>
                    </label>
                  ) : null}
                  <p className="text-xs text-muted-foreground" data-testid="recorder-range">
                    {range.from > 0 || range.to !== null
                      ? t(range.to !== null ? "recorder.screen.rangeTo" : "recorder.screen.rangeFrom", {
                          from: formatDuration(range.from),
                          to: formatDuration(range.to ?? 0),
                        })
                      : t("recorder.screen.rangeSong")}
                    {sectionCount > 0 ? ` · ${t("recorder.sectionsCount", { count: sectionCount })}` : ""}
                  </p>
                </div>
              ) : null}

              {/* What's heard while recording. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {opened && opened.kind === "own" && opened.parts.length > 0 ? (
                  <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <legend className="mb-1 text-xs text-muted-foreground">{t("recorder.hear")}</legend>
                    {opened.parts.map((file) => (
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
                {opened?.kind !== "player" ? (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={click} disabled={busy || !beat} onChange={(event) => setClick(event.target.checked)} data-testid="recorder-click" />
                    {t("recorder.click")}
                  </label>
                ) : null}
              </div>

              {/* Ready to record: the microphone's level, the delay taken off, the headphones. */}
              <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="recorder-ready">
                {phase === "ready" || phase === "recording" ? <InputLevel recorder={opened?.recorder ?? null} /> : null}
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
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={busy || takes.length > 0}
                      onClick={() => void calibrate("claps")}
                      data-testid="recorder-clap"
                    >
                      <Hand />
                      {t("recorder.clapAlong")}
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={busy || takes.length > 0}
                      onClick={() => void calibrate("loopback")}
                      data-testid="recorder-calibrate"
                    >
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
            </div>
          ) : null}

          {/* The takes so far: listen to each, pick the best, line it up. */}
          {takes.length > 0 ? (
            <div className="flex flex-col gap-2" data-testid="recorder-takes">
              <p className="text-sm font-medium">{t("recorder.screen.takes")}</p>
              <ul className="flex flex-col divide-y rounded-md border" role="radiogroup" aria-label={t("recorder.screen.takes")}>
                {takes.map((item) => {
                  const seconds = Math.max(0, item.take.captured.length / item.take.sampleRate - range.lead - 0.2);
                  const isPicked = item.number === picked && !item.silent;
                  return (
                    <li key={item.number} className={cn("flex flex-col gap-2 p-2", isPicked && "bg-muted/50")} data-testid="recorder-take" data-picked={isPicked ? "true" : "false"}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => void listen(item)} disabled={busy || item.silent} data-testid="recorder-preview">
                          {listening === item.number ? <Square /> : <Play />}
                          {listening === item.number ? t("recorder.stopPreview") : t("recorder.preview")}
                        </Button>
                        <span className="text-sm font-medium">{t("recorder.screen.takeN", { n: item.number })}</span>
                        <span className="text-xs text-muted-foreground">{[item.range, formatDuration(seconds), item.silent ? t("recorder.screen.silentTake") : null].filter(Boolean).join(" · ")}</span>
                        <span className="flex-1" />
                        <Button
                          type="button"
                          size="sm"
                          variant={isPicked ? "default" : "ghost"}
                          role="radio"
                          aria-checked={isPicked}
                          disabled={busy || item.silent}
                          onClick={() => setPicked(item.number)}
                          data-testid="recorder-pick"
                        >
                          <Check />
                          {isPicked ? t("recorder.screen.picked") : t("recorder.screen.pick")}
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          disabled={busy}
                          onClick={() => void remove(item.number)}
                          aria-label={t("recorder.screen.deleteTake", {
                            n: item.number,
                          })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      {isPicked && more ? (
                        <label className="flex items-center gap-2 text-xs">
                          <span className="shrink-0">{t("recorder.nudge")}</span>
                          <input
                            type="range"
                            min={-150}
                            max={150}
                            step={1}
                            value={item.nudge}
                            className="min-w-0 flex-1 accent-primary"
                            disabled={busy}
                            onChange={(event) => nudge(item.number, Number(event.target.value))}
                            aria-label={t("recorder.nudge")}
                            data-testid="recorder-nudge"
                          />
                          <span className="w-16 shrink-0 text-right tabular-nums">
                            {t("recorder.nudgeMs", {
                              ms: item.nudge > 0 ? `+${item.nudge}` : item.nudge,
                            })}
                          </span>
                        </label>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {more ? <p className="text-xs text-muted-foreground">{t("recorder.screen.takesHint")}</p> : null}
            </div>
          ) : null}
          {sectionCount > 0 && takes.length === 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="recorder-sections-kept">
              <Button type="button" variant="outline" size="sm" onClick={() => void listen(null)} disabled={busy}>
                {listening === "rest" ? <Square /> : <Play />}
                {listening === "rest" ? t("recorder.stopPreview") : t("recorder.preview")}
              </Button>
              <span>{t("recorder.sectionsCount", { count: sectionCount })}</span>
              <span className="text-xs text-muted-foreground">{t("recorder.screen.sectionsKeptHint")}</span>
            </div>
          ) : null}

          {more ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
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
          ) : null}
          {routeChanged && roundTrip ? (
          <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400" role="status" data-testid="recorder-route-changed">
            <Headphones className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t(roundTrip.measured ? "recorder.screen.routeMeasured" : "recorder.screen.routeNotMeasured", { name: routeChanged, ms: Math.round(roundTrip.seconds * 1000) })}
          </p>
        ) : null}
        {interrupted && phase !== "recording" ? (
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400" role="alert" data-testid="recorder-interrupted">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t(interrupted === "device" ? "recorder.interruptedDevice" : "recorder.interruptedSuspended")}
            </p>
          ) : null}
          {phase === "waiting" ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm" role="status" data-testid="recorder-waiting">
              <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("recorder.keptOnDevice")}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {micRefused ? (
            <Button type="button" variant="outline" className="self-start" onClick={() => open()} data-testid="recorder-allow">
              <Mic />
              {t("recorder.allowMicrophone")}
            </Button>
          ) : null}
          {confirmClose ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm" role="alert" data-testid="recorder-confirm-close">
              <span className="flex-1">{t("recorder.screen.closeDiscards")}</span>
              <Button type="button" size="sm" variant="destructive" onClick={onClose} data-testid="recorder-discard-close">
                {t("recorder.screen.discardAndClose")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirmClose(false)}>
                {t("recorder.screen.keepRecording")}
              </Button>
            </div>
          ) : null}
        </div>
        <div className={cn("flex flex-row flex-wrap items-center justify-end gap-2 border-t bg-popover px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]", inline && "rounded-b-lg bg-background px-3 pb-3")}>
          {phase === "waiting" ? (
            <Button type="button" onClick={onClose} data-testid="recorder-close">
              {t("recorder.close")}
            </Button>
          ) : phase === "recording" ? (
            <Button type="button" variant="destructive" size="lg" onClick={() => void stop()} data-testid="recorder-stop">
              <Square />
              {t("recorder.stop")}
            </Button>
          ) : (
            <>
              {chosen && multitrack && (what === "section" || what === "bar" || sectionCount > 0) ? (
                <Button type="button" variant="outline" onClick={keepSection} disabled={busy} data-testid="recorder-add-section">
                  <ListPlus />
                  {t("recorder.screen.keepSectionNext")}
                </Button>
              ) : null}
              {chosen || sectionCount > 0 ? (
                <Button type="button" variant="outline" onClick={() => void keep()} disabled={busy} data-testid="recorder-keep">
                  {phase === "saving" ? <Loader2 className="animate-spin" /> : null}
                  {phase === "saving" ? t("recorder.saving") : chosen ? t("recorder.screen.keepTake", { n: chosen.number }) : t("recorder.keep")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="destructive"
                size="lg"
                onClick={() => void start()}
                disabled={phase !== "ready" || !valid || calibrating !== null}
                data-testid={takes.length > 0 ? "recorder-again" : "recorder-start"}
              >
                {phase === "opening" && !error ? <Loader2 className="animate-spin" /> : takes.length > 0 ? <RotateCcw /> : <Circle className="fill-current" />}
                {takes.length > 0 ? t("recorder.again") : t("recorder.record")}
              </Button>
            </>
          )}
        </div>
    </Shell>
  );
}

/** A drawer from the bottom, not modal; or, in the player, a part of it. */
function Shell({ inline, onDismiss, label, children, ...data }: { inline: boolean; onDismiss: () => void; label: string; children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  if (inline)
    return (
      <section className="flex flex-col rounded-lg border bg-background pt-2" aria-label={label} {...data}>
        {children}
      </section>
    );
  return (
    <Drawer open modal={false} disablePointerDismissal swipeDirection="down" onOpenChange={(open) => !open && onDismiss()}>
      <DrawerContent className="max-h-[85dvh] sm:right-4 sm:left-4 sm:mx-auto sm:w-auto sm:max-w-3xl" aria-label={label} {...data}>
        {children}
      </DrawerContent>
    </Drawer>
  );
}

function Title({ inline, children }: { inline: boolean; children: ReactNode }) {
  return inline ? <p className="min-w-0 flex-1 truncate text-sm font-semibold">{children}</p> : <DrawerTitle className="min-w-0 flex-1 truncate">{children}</DrawerTitle>;
}
