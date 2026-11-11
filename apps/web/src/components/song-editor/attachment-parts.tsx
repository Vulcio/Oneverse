import { RECORDING_TIME_SIGNATURES, type Multitrack, type Attachment, type AttachmentAudience, type AttachmentType, type StemSeparation, type TeamSummary } from "@oneverse/core";
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
  onChange: (change: { recordingKey?: string | null; recordingTempo?: number | null; recordingFirstBeat?: number | null; recordingFreeIntro?: boolean; recordingTimeSignature?: string | null }) => void;
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
  busy,
  onChange,
  onRecord,
  children,
}: {
  multitrack: Multitrack<Attachment>;
  index: number;
  songKey: string;
  songTempo: string;
  /** The separation it came from (issue #175), if it did. */
  separation?: StemSeparation;
  busy: boolean;
  onChange: (files: Attachment[], change: Parameters<typeof apiClient.updateAttachment>[2]) => void;
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
      <DetectedNotice files={multitrack.files} canEdit={changeable.length > 0} busy={busy} onConfirm={() => onChange(changeable.filter((file) => file.detected?.length), { confirmDetected: true })} />
      {children}
    </div>
  );
}

/**
 * What the separation server's analysis found and nobody has confirmed yet
 * (issue #175): said, with "Looks right"; changing one confirms it.
 */
export function DetectedNotice({ files, canEdit, busy, onConfirm }: { files: Attachment[]; canEdit: boolean; busy: boolean; onConfirm: () => void }) {
  const { t } = useTranslation();
  const holder = files.find((file) => file.detected?.length);
  if (!holder) return null;
  const detected = holder.detected ?? [];
  const details = [
    detected.includes("key") ? holder.recordingKey : null,
    detected.includes("tempo") && holder.recordingTempo ? `${holder.recordingTempo} BPM` : null,
    detected.includes("timeSignature") ? holder.recordingTimeSignature : null,
    detected.includes("firstBeat") && holder.recordingFirstBeat != null ? t("stems.firstBeatAt", { seconds: holder.recordingFirstBeat }) : null,
    detected.includes("beats") && holder.recordingDownbeats?.length ? t("stems.detectedBars", { count: holder.recordingDownbeats.length }) : null,
    detected.includes("sections") ? t("stems.detectedSections") : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs" data-testid="detected">
      <span className="min-w-0 flex-1">{t("stems.detected", { details })}</span>
      {canEdit ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onConfirm} data-testid="confirm-detected">
          {t("stems.confirmDetected")}
        </Button>
      ) : null}
    </p>
  );
}
