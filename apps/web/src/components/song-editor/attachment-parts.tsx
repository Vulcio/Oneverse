import { RECORDING_TIME_SIGNATURES, surenessOf, type AnalyseRecordingRequest, type CheckedDetail, type Multitrack, type Attachment, type AttachmentAudience, type AttachmentType, type StemSeparation, type TeamSummary } from "@oneverse/core";
import { Mic, Play } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { apiClient } from "#/lib/api-client";
import { setlistTitle } from "#/lib/setlists";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Input } from "@oneverse/ui/components/input";
import { KeySelect } from "#/components/key-select";
import { useMultitrackName } from "#/lib/multitrack-name";
import { HighQuality, separationModels } from "./stem-separation";

/** The parts of the Audio and Files tab (issue #427, out of `song-tabs.tsx`): who sees a file, a recording's player and fields, a multitrack's box. */

export const FILE_TYPES: AttachmentType[] = ["PDF", "CHORDPRO", "MUSICXML", "ABC_NOTATION", "TEXT", "IMAGE", "OTHER"];

/** A file's audience as one select value: "PRIVATE", "SONG", "SHARED" or "TEAM:<id>". */
export const audienceValue = (audience: AttachmentAudience) => (audience.visibility === "TEAM" ? `TEAM:${audience.teamId}` : audience.visibility);
export const audienceOf = (value: string): AttachmentAudience =>
  value.startsWith("TEAM:") ? { visibility: "TEAM", teamId: value.slice(5) } : { visibility: value as "PRIVATE" | "SONG" | "SHARED" };

/**
 * Who sees a file (issue #72): only me, one of my teams, everyone who can
 * see the song, or the people it's shared with (#79) - those two for who
 * manages the song.
 */
export function AudienceSelect({
  value,
  teams,
  canShowToSong,
  canShowToShared,
  disabled,
  label,
  onChange,
}: {
  value: AttachmentAudience;
  teams: TeamSummary[];
  canShowToSong: boolean;
  canShowToShared: boolean;
  disabled?: boolean;
  label: string;
  onChange: (audience: AttachmentAudience) => void;
}) {
  const { t } = useTranslation();
  // A team the file is shown to but that isn't in the list (left since) still shows.
  const listed = value.visibility === "TEAM" && value.teamId && !teams.some((team) => team.id === value.teamId);
  return (
    <NativeSelect compact value={audienceValue(value)} disabled={disabled} aria-label={label} onChange={(event) => onChange(audienceOf(event.target.value))}>
      <option value="PRIVATE">{t("fileVisibility.private")}</option>
      {teams.map((team) => (
        <option key={team.id} value={`TEAM:${team.id}`}>
          {t("fileVisibility.team", { team: team.name })}
        </option>
      ))}
      {listed ? <option value={audienceValue(value)}>{t("fileVisibility.team", { team: "…" })}</option> : null}
      {canShowToShared || value.visibility === "SHARED" ? <option value="SHARED">{t("fileVisibility.shared")}</option> : null}
      {canShowToSong || value.visibility === "SONG" ? <option value="SONG">{t("fileVisibility.song")}</option> : null}
    </NativeSelect>
  );
}

/** Who sees a file, for someone who can't change it. */
export function audienceText(attachment: Attachment, t: (key: string, options?: Record<string, unknown>) => string): string {
  const by = attachment.uploadedBy?.displayName;
  if (attachment.visibility === "TEAM") return t(by ? "fileVisibility.sharedByWithTeam" : "fileVisibility.sharedWithTeam", { name: by, team: attachment.visibleToTeam?.name ?? "" });
  if (attachment.visibility === "PRIVATE") return t("fileVisibility.privateOf", { name: by ?? "" });
  if (attachment.visibility === "SHARED") return by ? t("fileVisibility.sharedByWithPeople", { name: by }) : t("fileVisibility.sharedWithPeople");
  return by ? t("fileVisibility.addedBy", { name: by }) : "";
}

export function AudioPlayer({ songVersionId, attachment }: { songVersionId: string; attachment: Attachment }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  // Where to carry on from once a fresh link has loaded.
  const resumeAt = useRef<number | null>(null);
  const renewed = useRef(false);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      // A signed link (issue #33): the <audio> streams and seeks by itself, which it can't with the Bearer token.
      setUrl((await apiClient.getAttachmentLink(songVersionId, attachment.id)).url);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  // A link that ran out mid-rehearsal: a new one, from where it was.
  async function renew() {
    if (renewed.current) {
      setError(true);
      return;
    }
    renewed.current = true;
    resumeAt.current = audio.current?.currentTime ?? 0;
    await load();
  }

  if (url) {
    return (
      <>
        <audio
          ref={audio}
          controls
          autoPlay
          preload="metadata"
          src={url}
          className="h-9 w-full"
          aria-label={attachment.filename}
          onError={() => void renew()}
          onLoadedMetadata={(event) => {
            if (resumeAt.current !== null) event.currentTarget.currentTime = resumeAt.current;
            resumeAt.current = null;
          }}
          onPlaying={() => {
            renewed.current = false;
          }}
        />
        {error ? <span className="text-xs text-destructive">{t("songEditor.audioFailed")}</span> : null}
      </>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
        <Play />
        {loading ? t("songEditor.loadingAudio") : t("songEditor.play")}
      </Button>
      {error ? <span className="text-xs text-destructive">{t("songEditor.audioFailed")}</span> : null}
    </div>
  );
}

/**
 * A recording's key and tempo (issue #65), when they aren't the song's -
 * for later, to transpose it and change its speed. Empty is the song's own.
 */
export function RecordingFields({
  files,
  label,
  songKey,
  songTempo,
  canEdit,
  busy,
  onChange,
}: {
  files: Attachment[];
  /** Whose: a file's name; the stems when left out. */
  label?: string;
  songKey: string;
  songTempo: string;
  canEdit: boolean;
  busy: boolean;
  onChange: (change: { recordingKey?: string | null; recordingTempo?: number | null; recordingFirstBeat?: number | null; recordingFreeIntro?: boolean; recordingTimeSignature?: string | null; recordingBeatShift?: { seconds?: number; beats?: number } }) => void;
}) {
  const { t } = useTranslation();
  const first = files[0];
  // Played freely before its first beat (issue #178): the click waits for it.
  const freeIntro = files.some((file) => file.recordingFreeIntro);
  const [free, setFree] = useState(freeIntro);
  useEffect(() => setFree(freeIntro), [freeIntro]);
  const saved = first?.recordingTempo != null ? String(first.recordingTempo) : "";
  const [tempo, setTempo] = useState(saved);
  useEffect(() => setTempo(saved), [saved]);
  // Where its first beat falls (issue #100), for the metronome.
  const savedBeat = first?.recordingFirstBeat != null ? String(first.recordingFirstBeat) : "";
  const [firstBeat, setFirstBeat] = useState(savedBeat);
  useEffect(() => setFirstBeat(savedBeat), [savedBeat]);
  const keyLabel = label ? t("stems.recordingKey", { name: label }) : t("stems.stemsKey");
  const tempoLabel = label ? t("stems.recordingTempo", { name: label }) : t("stems.stemsTempo");
  const firstBeatLabel = label ? t("stems.recordingFirstBeat", { name: label }) : t("stems.stemsFirstBeat");

  if (!canEdit) {
    const details = [
      first?.recordingKey,
      first?.recordingTempo ? `${first.recordingTempo} BPM` : null,
      first?.recordingTimeSignature,
      first?.recordingFirstBeat ? t("stems.firstBeatAt", { seconds: first.recordingFirstBeat }) : null,
      freeIntro ? t("stems.freeIntro") : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return details ? <p className="text-xs text-muted-foreground">{t("stems.recordedIn", { details })}</p> : null;
  }
  function saveTempo() {
    const next = tempo.trim() ? Number(tempo) : null;
    if ((next === null && !saved) || String(next) === saved || (next !== null && !Number.isFinite(next))) return;
    onChange({ recordingTempo: next });
  }
  function saveFirstBeat() {
    const next = firstBeat.trim() ? Number(firstBeat) : null;
    if ((next === null && !savedBeat) || String(next) === savedBeat || (next !== null && (!Number.isFinite(next) || next < 0))) return;
    onChange({ recordingFirstBeat: next });
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <label className="flex items-center gap-2">
        {t("stems.keyLabel")}
        <KeySelect
          compact
          value={first?.recordingKey ?? ""}
          disabled={busy}
          aria-label={keyLabel}
          noneLabel={songKey ? t("stems.songsKeyIs", { key: songKey }) : t("stems.songsKey")}
          onChange={(value) => onChange({ recordingKey: value || null })}
        />
      </label>
      <label className="flex items-center gap-2">
        {t("stems.tempoLabel")}
        <Input
          type="number"
          inputMode="decimal"
          min={20}
          max={400}
          step="any"
          value={tempo}
          disabled={busy}
          placeholder={songTempo || "BPM"}
          aria-label={tempoLabel}
          className="h-8 w-20 text-xs"
          onChange={(event) => setTempo(event.target.value)}
          onBlur={saveTempo}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              saveTempo();
            }
          }}
        />
      </label>
      <label className="flex items-center gap-2">
        {t("stems.firstBeatLabel")}
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={600}
          step="any"
          value={firstBeat}
          disabled={busy}
          placeholder="0"
          aria-label={firstBeatLabel}
          className="h-8 w-20 text-xs"
          onChange={(event) => setFirstBeat(event.target.value)}
          onBlur={saveFirstBeat}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              saveFirstBeat();
            }
          }}
        />
      </label>
      {first?.recordingFirstBeat != null || first?.recordingBeats?.length ? (
        // Its 1 moved by ear (issue #448), the detected beats kept: a beat either way, or a few ms.
        <div className="flex items-center gap-1" role="group" aria-label={t("stems.moveOne")} title={t("stems.moveOneHint")} data-testid="recording-move-one">
          {t("stems.moveOne")}
          {(
            [
              ["−1", "moveOneEarlierBeat", { beats: -1 }],
              ["−10 ms", "moveOneEarlierMs", { seconds: -0.01 }],
              ["+10 ms", "moveOneLaterMs", { seconds: 0.01 }],
              ["+1", "moveOneLaterBeat", { beats: 1 }],
            ] as const
          ).map(([text, name, shift]) => (
            <Button key={name} type="button" variant="outline" size="sm" className="h-8 px-2 text-xs tabular-nums" disabled={busy} aria-label={t(`stems.${name}`)} onClick={() => onChange({ recordingBeatShift: shift })}>
              {text}
            </Button>
          ))}
        </div>
      ) : null}
      <label className="flex items-center gap-2">
        {t("stems.timeSignatureLabel")}
        <NativeSelect
          compact
          value={first?.recordingTimeSignature ?? ""}
          disabled={busy}
          aria-label={label ? t("stems.recordingTimeSignature", { name: label }) : t("stems.stemsTimeSignature")}
          onChange={(event) => onChange({ recordingTimeSignature: event.target.value || null })}
        >
          <option value="">{t("stems.songsTimeSignature")}</option>
          {RECORDING_TIME_SIGNATURES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex items-center gap-2" title={t("stems.freeIntroHint")}>
        <input
          type="checkbox"
          className="accent-primary"
          checked={free}
          disabled={busy}
          aria-label={label ? t("stems.recordingFreeIntro", { name: label }) : t("stems.stemsFreeIntro")}
          data-testid="recording-free-intro"
          onChange={(event) => {
            setFree(event.target.checked);
            onChange({ recordingFreeIntro: event.target.checked });
          }}
        />
        {t("stems.freeIntro")}
      </label>
    </div>
  );
}

/**
 * One of the song's multitracks (issue #123): its name, and what its
 * parts were recorded in - key, tempo, time signature, first beat - which
 * they share, so a change goes to all of them. Record adds a part to it.
 */
export function MultitrackBox({
  multitrack,
  index,
  songKey,
  songTempo,
  separation,
  asking,
  busy,
  onChange,
  onAnalyse,
  onRecord,
  children,
}: {
  multitrack: Multitrack<Attachment>;
  index: number;
  songKey: string;
  songTempo: string;
  /** The separation it came from (issue #175), if it did. */
  separation?: StemSeparation;
  /** The latest time Sonic was asked to listen again to its recording (issue #452). */
  asking?: StemSeparation;
  busy: boolean;
  onChange: (files: Attachment[], change: Parameters<typeof apiClient.updateAttachment>[2]) => void;
  /** Sonic asked to listen again to its recording with what you say of it (issue #452), from one of its stems. */
  onAnalyse: (stem: Attachment, hints: AnalyseRecordingRequest) => void;
  onRecord: () => void;
  /** Its files: its stems, then the recordings made into it. */
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useMultitrackName();
  const changeable = [...multitrack.files, ...multitrack.otherTakes].filter((file) => file.canChange);
  const set = [...multitrack.files, ...multitrack.otherTakes].find((file) => file.multitrackSetlist)?.multitrackSetlist ?? null;
  const name = nameOf(multitrack, index);
  const [draft, setDraft] = useState(multitrack.name ?? "");
  useEffect(() => setDraft(multitrack.name ?? ""), [multitrack.name]);
  function saveName() {
    const next = draft.trim();
    if (next === (multitrack.name ?? "")) return;
    onChange(changeable, { multitrackName: next || null });
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="stems-recording" data-multitrack={multitrack.id ?? ""}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium">
          {name}{" "}
          <span className="font-normal text-muted-foreground">
            · {t("stems.partsCount", { count: multitrack.files.length })}
            {multitrack.otherTakes.length > 0 ? ` · ${t("stems.otherTakesCount", { count: multitrack.otherTakes.length })}` : ""}
          </span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRecord} disabled={busy} data-testid="record-part">
          <Mic />
          {t("recorder.recordPart")}
        </Button>
      </div>
      {/* Recorded for a set (issue #127): what that set's song page plays. */}
      {set ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="multitrack-set">
          {t("stems.forSet", { name: setlistTitle(set, t, i18n.language) })}
          {changeable.length > 0 ? (
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={busy} onClick={() => onChange(changeable, { multitrackSetlistId: null })}>
              {t("stems.notForSet")}
            </Button>
          ) : null}
        </p>
      ) : null}
      {/* Separated (issues #63, #175): with which models, and whether its finer version is in. */}
      {separation ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="multitrack-separation">
          {separationModels(separation) ? t("separation.models", { models: separationModels(separation) }) : null}
          {separation.hqDone ? <HighQuality /> : separation.hqRequested && separation.status === "FAST_READY" ? <span>{t("separation.finerComing")}</span> : null}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("stems.recordingHint")}</p>
      {changeable.length > 0 ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("stems.multitrackNameLabel")}
          <Input
            value={draft}
            maxLength={60}
            disabled={busy}
            placeholder={name}
            aria-label={t("stems.multitrackNameOf", { name })}
            className="h-8 w-48 text-xs"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveName();
              }
            }}
          />
        </label>
      ) : null}
      <RecordingFields
        files={changeable.length > 0 ? changeable : multitrack.files}
        songKey={songKey}
        songTempo={songTempo}
        canEdit={changeable.length > 0}
        busy={busy}
        onChange={(change) => onChange(changeable, change)}
      />
      <DetectedNotice
        files={multitrack.files}
        canEdit={changeable.length > 0}
        busy={busy}
        asking={asking}
        onConfirm={() => onChange(changeable.filter((file) => file.detected?.length), { confirmDetected: true })}
        onSetKey={(key) => onChange(changeable, { recordingKey: key })}
        onAnalyse={(hints) => {
          const stem = changeable.find((file) => file.origin === "SEPARATED");
          if (stem) onAnalyse(stem, hints);
        }}
      />
      {children}
    </div>
  );
}

/**
 * What the separation server's analysis found and nobody has confirmed yet
 * (issue #175), to check (issue #452): each detail with how sure it was and
 * what else it might be. A key is set at once; another tempo, time
 * signature or bar 1 asks Sonic to listen again with it, which finds the
 * beats and sections around it. "Looks right" confirms them all; changing
 * one by hand confirms it.
 */
export function DetectedNotice({
  files,
  canEdit,
  busy,
  asking,
  onConfirm,
  onSetKey,
  onAnalyse,
}: {
  files: Attachment[];
  canEdit: boolean;
  busy: boolean;
  /** The latest time Sonic was asked again for these stems (issue #452), if it was. */
  asking?: StemSeparation;
  onConfirm: () => void;
  onSetKey: (key: string) => void;
  onAnalyse: (hints: AnalyseRecordingRequest) => void;
}) {
  const { t } = useTranslation();
  const holder = files.find((file) => file.detected?.length || file.recordingAnalysis?.alternatives) ?? files.find((file) => file.recordingAnalysis);
  const pending = asking && (asking.status === "QUEUED" || asking.status === "SUBMITTED");
  const failed = asking?.status === "FAILED" ? asking : null;
  if (!holder || (!holder.detected?.length && !pending && !unsureDetails(holder).length)) return null;
  const detected = holder.detected ?? [];
  const check = holder.recordingAnalysis ?? null;
  const seconds = (value: number) => t("stems.checkSeconds", { seconds: value });
  const rows: { detail: CheckedDetail | "beats" | "sections" | "chords"; value: string | null; sureness: number | undefined; options: { label: string; pick: () => void }[] }[] = [];
  const offered = <T extends string | number>(detail: CheckedDetail, current: T | null, label: (value: T) => string, pick: (value: T) => void) => {
    const options = ((check?.alternatives?.[detail] ?? []) as unknown as { value: T }[]).filter((one) => one.value !== current).map((one) => ({ label: label(one.value), pick: () => pick(one.value) }));
    const shown = detected.includes(detail) || (current === null && options.length > 0);
    if (shown) rows.push({ detail, value: detected.includes(detail) && current !== null ? label(current) : null, sureness: check?.confidence?.[detail === "firstBeat" ? "beats" : detail], options: canEdit ? options : [] });
  };
  offered("key", holder.recordingKey, (value) => value, onSetKey);
  offered("tempo", holder.recordingTempo, (value) => `${value} BPM`, (value) => onAnalyse({ tempo: value }));
  offered("timeSignature", holder.recordingTimeSignature, (value) => value, (value) => onAnalyse({ timeSignature: value }));
  offered("firstBeat", holder.recordingFirstBeat, seconds, (value) => onAnalyse({ firstBeat: value }));
  if (detected.includes("beats") && holder.recordingDownbeats?.length) rows.push({ detail: "beats", value: t("stems.detectedBars", { count: holder.recordingDownbeats.length }), sureness: check?.confidence?.beats, options: [] });
  if (detected.includes("sections")) rows.push({ detail: "sections", value: t("stems.checkChordsFound"), sureness: undefined, options: [] });
  if (detected.includes("chords")) rows.push({ detail: "chords", value: t("stems.checkChordsFound"), sureness: undefined, options: [] });
  const hints = asking?.hints
    ? [asking.hints.timeSignature, asking.hints.tempo !== undefined ? `${asking.hints.tempo} BPM` : null, asking.hints.firstBeat !== undefined ? seconds(asking.hints.firstBeat) : null].filter(Boolean).join(", ")
    : "";
  const label = { key: "checkKey", tempo: "checkTempo", timeSignature: "checkTimeSignature", firstBeat: "checkFirstBeat", beats: "checkBeats", sections: "checkSections", chords: "checkChords" } as const;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2 text-xs" data-testid="detected">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium">{t("stems.checkTitle")}</span>
        {canEdit && detected.length > 0 ? (
          <Button type="button" variant="outline" size="sm" disabled={busy || pending} onClick={onConfirm} data-testid="confirm-detected">
            {t("stems.confirmDetected")}
          </Button>
        ) : null}
      </div>
      {pending ? (
        <p className="text-muted-foreground" role="status" data-testid="check-asking">
          {t("stems.checkAsking", { hints })}
        </p>
      ) : failed ? (
        <p className="text-destructive" data-testid="check-failed">
          {t("stems.checkFailed", { error: failed.error ?? "" })}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
          {rows.map((row) => {
            const sureness = surenessOf(row.sureness);
            return (
              <div key={row.detail} className="contents" data-testid={`check-${row.detail}`}>
                <dt className="text-muted-foreground">{t(`stems.${label[row.detail]}`)}</dt>
                <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {row.value !== null ? <span className="font-medium">{row.value}</span> : <span className="text-muted-foreground">{t("stems.checkUnsure")}</span>}
                  {row.value !== null && sureness ? (
                    <span className={sureness === "guess" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"} data-testid="check-sureness" data-sureness={sureness}>
                      · {t(`stems.checkSure_${sureness}`)}
                    </span>
                  ) : null}
                  {row.options.length > 0 ? (
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="text-muted-foreground">{row.value !== null ? t("stems.checkOr") : null}</span>
                      {row.options.map((option) => (
                        <Button
                          key={option.label}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={busy || pending}
                          aria-label={t("stems.checkUse", { value: option.label })}
                          onClick={option.pick}
                          data-testid="check-alternative"
                        >
                          {option.label}
                        </Button>
                      ))}
                    </span>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      {canEdit && rows.some((row) => row.options.length > 0) ? <p className="text-muted-foreground">{t("stems.checkHint")}</p> : null}
    </div>
  );
}

/** The details the analysis was too unsure of to use, but offered something for (issue #452). */
function unsureDetails(file: Attachment): CheckedDetail[] {
  const alternatives = file.recordingAnalysis?.alternatives ?? {};
  const value = { key: file.recordingKey, tempo: file.recordingTempo, timeSignature: file.recordingTimeSignature, firstBeat: file.recordingFirstBeat };
  return (Object.keys(value) as CheckedDetail[]).filter((detail) => value[detail] === null && alternatives[detail]?.length);
}
