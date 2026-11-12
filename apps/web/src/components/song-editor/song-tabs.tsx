import { isAudioFilename, type BeatLevel, multitracksOf, newMultitrackId, stemPartFromFilename, type Attachment, type AttachmentAudience, type AttachmentType, type StemSeparationParts, type StorageUsage, type TeamSummary, type CueSection } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { Download, FileAudio, Lock, LockOpen, Mic, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AttachmentThumbnail } from "#/components/attachment-thumbnail";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { cn } from "@oneverse/ui/lib/utils";
import { attachmentTypeFor } from "./attachment-types";
import { downloadBlob } from "#/lib/download";
import { formatBytes } from "#/lib/format-bytes";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { setMode, useMode } from "#/lib/mode";
import { stemsOf } from "#/lib/stem-files";
import { useMultitrackName } from "#/lib/multitrack-name";
import { NEW_TARGET, RecordScreen } from "#/components/record-screen";
import { StoredTakes } from "#/components/stored-takes";
import { PartPicker, usePartLabel } from "#/components/part-picker";
import { CleanUp } from "./clean-up";
import { SeparateButton, SeparationList, useStemSeparations } from "./stem-separation";
import { FieldError } from "@oneverse/ui/components/field";
import { Empty } from "@oneverse/ui/components/empty";
import { AudienceSelect, audienceText, AudioPlayer, FILE_TYPES, MultitrackBox, RecordingFields } from "./attachment-parts";

const NEW_MULTITRACK = "__new";

export function SaveFirst() {
  const { t } = useTranslation();
  return (
    <Empty variant="card">{t("songEditor.saveFirst")}</Empty>
  );
}

/** Files or Audio: what's attached, and an upload drop zone for editors. */
export function AttachmentsTab({
  kind,
  songVersionId,
  attachments,
  canEdit,
  canShare = false,
  songKey = "",
  songTempo = "",
  songTimeSignature = "",
  songMetronomeBeats = "",
  songTitle = "",
  cueSections = [],
}: {
  kind: "files" | "audio";
  songVersionId: string;
  attachments: Attachment[];
  /** Can edit the song: can show files to everyone who sees it. Anyone who sees it adds their own. */
  canEdit: boolean;
  /** Can show files to the people the song is shared with (#79): who manages a personal or team song. */
  canShare?: boolean;
  /** The song's own, which a recording's key and tempo default to (#65). */
  songKey?: string;
  songTempo?: string;
  /** "4/4": what a new multitrack's click defaults to (#123). */
  songTimeSignature?: string;
  /** The version's metronome pattern (issue #384), its levels joined by commas; "" for the player's own. */
  songMetronomeBeats?: string;
  songTitle?: string;
  /** The song's sections, to record one of them (issue #365). */
  cueSections?: CueSection[];
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { mode } = useMode();
  const inputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<AttachmentType | "AUTO">("AUTO");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  // Who sees what's added: only its uploader, until they choose otherwise (issue #72).
  const [audience, setAudience] = useState<AttachmentAudience>({ visibility: "PRIVATE" });
  const stems = kind === "audio" ? stemsOf(attachments) : [];
  // The parts recorded together (issue #123): the song's original stems, and the multitracks since.
  const multitracks = kind === "audio" ? multitracksOf(attachments) : [];
  const nameOf = useMultitrackName();
  const partLabel = usePartLabel();
  // Recording a part (issue #123): into a multitrack, or a new one (null).
  const [recording, setRecording] = useState<{ target: string } | null>(null);
  // Takes being turned into Opus by the Worker (issue #127): looked at again until they're done.
  const processing = attachments.some((file) => file.processing === "PENDING");
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void router.invalidate(), 3000);
    return () => clearInterval(timer);
  }, [processing]);

  // The largest file of each type (issue #163), from Admin > Storage: checked before sending one.
  const [limitsMb, setLimitsMb] = useState<Record<string, number> | null>(null);
  // Uploading audio files is a role's (issue #183); recording here isn't. Offered until the API says otherwise.
  const [canUploadAudio, setCanUploadAudio] = useState(true);
  useEffect(() => {
    apiClient
      .getUploadLimits(songVersionId)
      .then((limits) => {
        setLimitsMb(limits.limitsMb);
        setCanUploadAudio(limits.canUploadAudio !== false);
      })
      .catch(() => {
        // Offline: the API says so if a file's too big.
      });
  }, [songVersionId]);
  const filesLimitMb = limitsMb ? Math.max(...Object.entries(limitsMb).filter(([fileType]) => fileType !== "AUDIO").map(([, mb]) => mb)) : null;

  // Splitting a recording into stems on the Demucs server (issue #63), for who's allowed to.
  const separation = useStemSeparations(songVersionId, kind === "audio");
  const separations = separation.state?.separations ?? [];

  // An audio file's or another file's row; a recording says who made it and when (issue #175).
  const fileRow = (attachment: Attachment, recorded = false) => (
    // With room (issue #177), an audio file's settings side by side under its name rather than stacked.
    <li key={attachment.id} className={cn("flex flex-col gap-2 py-3 first:pt-0 last:pb-0", kind === "audio" && "@5xl:flex-row @5xl:flex-wrap @5xl:items-center @5xl:gap-x-6")}>
      <div className="flex flex-wrap items-center gap-3 @5xl:basis-full">
        {kind === "audio" ? (
          <FileAudio className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        ) : attachment.type === "IMAGE" || attachment.mimeType.startsWith("image/") ? (
          <AttachmentThumbnail songVersionId={songVersionId} attachmentId={attachment.id} alt={attachment.filename} />
        ) : (
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{t(`songEditor.fileTypes.${attachment.type}`)}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm">{attachment.filename}</span>
        {attachment.sizeBytes !== null ? (
          <span className="text-xs text-muted-foreground">{formatBytes(attachment.sizeBytes)}</span>
        ) : null}
        <span className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void download(attachment)}
            disabled={busyId !== null}
            aria-label={t("songEditor.downloadName", { name: attachment.filename })}
          >
            <Download />
          </Button>
          {/* A lossless upload's original, kept as FLAC beside the Opus copy (issue #182). */}
          {attachment.original ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void download(attachment, true)}
              disabled={busyId !== null}
              aria-label={t("songEditor.downloadOriginal", { name: attachment.filename })}
              title={t("songEditor.downloadOriginal", { name: attachment.filename }) + (attachment.original.sizeBytes ? ` (${formatBytes(attachment.original.sizeBytes)})` : "")}
              data-testid="download-original"
            >
              <Download />
              FLAC
            </Button>
          ) : null}
          {/* Locked (issue #145): kept as uploaded until its uploader unlocks it. */}
          {kind === "audio" && (attachment.locked || attachment.canChangeVisibility) ? (
            <Button
              type="button"
              variant={attachment.locked ? "secondary" : "ghost"}
              size="sm"
              onClick={() => void update([attachment], { locked: !attachment.locked })}
              disabled={busyId !== null || !attachment.canChangeVisibility}
              aria-pressed={!!attachment.locked}
              aria-label={t(attachment.locked ? "stems.unlockName" : "stems.lockName", { name: attachment.filename })}
              title={attachment.locked ? (attachment.canChangeVisibility ? t("stems.lockedHint") : t("stems.lockedByUploader")) : t("stems.unlockedHint")}
              data-testid="file-lock"
            >
              {attachment.locked ? <Lock /> : <LockOpen />}
            </Button>
          ) : null}
          {attachment.canChange ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void remove(attachment)}
              disabled={busyId !== null || !!attachment.locked}
              title={attachment.locked ? t("stems.unlockToDelete") : undefined}
              aria-label={t("songEditor.removeName", { name: attachment.filename })}
              data-testid="file-remove"
            >
              <Trash2 />
            </Button>
          ) : null}
        </span>
      </div>
      {/* Recorded in Songverse (issue #175): who, and when. */}
    {recorded ? (
      <span className="text-xs text-muted-foreground" data-testid="recorded-by">
        {attachment.uploadedBy
          ? t("stems.recordedByOn", { name: attachment.uploadedBy.displayName, date: new Date(attachment.createdAt).toLocaleDateString(i18n.language) })
          : t("stems.recordedOn", { date: new Date(attachment.createdAt).toLocaleDateString(i18n.language) })}
      </span>
    ) : null}
    {/* A recorded take (issue #127): being processed, or not played (another take of its part). */}
      {kind === "audio" && (attachment.otherTake || attachment.processing) ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="take-state">
          {attachment.processing === "PENDING" ? <span className="text-muted-foreground">{t("recorder.processing")}</span> : null}
          {attachment.processing === "FAILED" ? <span className="text-destructive">{t("recorder.processingFailed")}</span> : null}
          {attachment.otherTake ? (
            <>
              <span className="rounded-md bg-muted px-2 py-1 font-medium">{t("recorder.otherTake")}</span>
              {attachment.canChange ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void useTake(attachment)} disabled={busyId !== null} data-testid="use-take">
                  {t("recorder.useThisTake")}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="file-visibility">
        {attachment.canChangeVisibility ? (
          <label className="flex items-center gap-2">
            {t("fileVisibility.label")}
            <AudienceSelect
              value={{ visibility: attachment.visibility, teamId: attachment.visibleToTeamId }}
              teams={teams}
              canShowToSong={canEdit}
              canShowToShared={canShare}
              disabled={busyId !== null}
              label={t("fileVisibility.labelFor", { name: attachment.filename })}
              onChange={(next) => void update([attachment], { visibility: next.visibility, teamId: next.teamId ?? null })}
            />
          </label>
        ) : (
          <span>{audienceText(attachment, t)}</span>
        )}
      </div>
      {kind === "audio" && attachment.canChange ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {t("stems.part")}
          {/* A voice, an instrument or the cues, then which (issue #131). */}
          <PartPicker
            compact
            allowNone
            value={{ stemPart: attachment.stemPart, partName: attachment.partName }}
            disabled={busyId !== null}
            label={t("stems.partOf", { name: attachment.filename })}
            onChange={(next) => void update([attachment], next)}
          />
        </div>
      ) : kind === "audio" && attachment.stemPart ? (
        <span className="self-start rounded-md bg-muted px-2 py-1 text-xs font-medium" data-testid="part-label">
          {partLabel(attachment)}
        </span>
      ) : null}
      {/* Which multitrack it's part of (issue #123): the files of another version go in one of their own. */}
      {kind === "audio" && attachment.canChange && attachment.stemPart ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("stems.multitrack")}
          <NativeSelect
            compact
            value={attachment.multitrackId ?? ""}
            disabled={busyId !== null}
            aria-label={t("stems.multitrackOf", { name: attachment.filename })}
            onChange={(event) => {
              const value = event.target.value;
              const target = multitracks.find((multitrack) => (multitrack.id ?? "") === value);
              const first = target?.files.find((file) => file.id !== attachment.id);
              // Into another multitrack: with its key, tempo and beat; into a new one, keeping its own.
              void update([attachment], {
                multitrackId: value === NEW_MULTITRACK ? newMultitrackId() : value || null,
                multitrackName: value === NEW_MULTITRACK ? null : (first?.multitrackName ?? null),
                ...(first
                  ? {
                      recordingKey: first.recordingKey,
                      recordingTempo: first.recordingTempo,
                      recordingTimeSignature: first.recordingTimeSignature,
                      recordingFirstBeat: first.recordingFirstBeat,
                    }
                  : {}),
              });
            }}
          >
            {multitracks.map((multitrack, index) => (
              <option key={multitrack.id ?? ""} value={multitrack.id ?? ""}>
                {nameOf(multitrack, index)}
              </option>
            ))}
            {multitracks.some((multitrack) => multitrack.id === null) ? null : <option value="">{t("stems.originalStems")}</option>}
            <option value={NEW_MULTITRACK}>{t("stems.newMultitrack")}</option>
          </NativeSelect>
        </label>
      ) : null}
      {/* A recording on its own has its own key and tempo; the stems share theirs (above the list). */}
      {kind === "audio" && !attachment.stemPart ? (
        <RecordingFields
          files={[attachment]}
          label={attachment.filename}
          songKey={songKey}
          songTempo={songTempo}
          canEdit={attachment.canChange}
          busy={busyId !== null}
          onChange={(change) => void update([attachment], change)}
        />
      ) : null}
      {kind === "audio" ? <AudioPlayer songVersionId={songVersionId} attachment={attachment} /> : null}
      {/* Cleaned up afterwards (issue #132). */}
      {kind === "audio" && attachment.canChange && !attachment.locked ? (
        <CleanUp file={attachment} busy={busyId !== null} onCleanUp={(steps) => void cleanUp(attachment, steps)} />
      ) : null}
      {kind === "audio" &&
      separation.state?.available &&
      attachment.type === "AUDIO" &&
      !attachment.stemPart &&
      !separations.some((item) => item.sourceAttachmentId === attachment.id && (item.status === "QUEUED" || item.status === "SUBMITTED")) ? (
        <SeparateButton file={attachment} busy={busyId !== null} canReplace={canReplace(attachment)} server={separation.state?.server} onStart={(parts, replace) => separate(attachment, parts, replace)} />
      ) : null}
    </li>
  );
  // Separated before, its stems still here: a new separation can replace them (issue #175).
  const canReplace = (file: Attachment) =>
    separations.some((item) => item.sourceAttachmentId === file.id && item.multitrackId && attachments.some((other) => other.multitrackId === item.multitrackId && other.origin === "SEPARATED"));

  async function separate(file: Attachment, parts: StemSeparationParts, replace: boolean) {
    setError(null);
    try {
      await apiClient.separateStems(songVersionId, file.id, parts, replace);
      separation.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function retrySeparation(id: string) {
    setError(null);
    try {
      await apiClient.retryStemSeparation(id);
      separation.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Cleans up a file afterwards (issue #132): the Worker does it; the list is looked at again until it's done. */
  async function cleanUp(file: Attachment, steps: ("voice" | "level" | "noise")[]) {
    setBusyId(file.id);
    setError(null);
    try {
      await apiClient.processAttachment(songVersionId, file.id, steps);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  /** Plays another take of a part (issue #127), instead of the one of that part playing, which becomes another take. */
  async function useTake(take: Attachment) {
    const playing = attachments.find(
      (file) =>
        file.type === "AUDIO" &&
        !file.otherTake &&
        file.canChange &&
        file.stemPart === take.stemPart &&
        (file.partName ?? null) === (take.partName ?? null) &&
        (file.multitrackId ?? null) === (take.multitrackId ?? null),
    );
    setBusyId(take.id);
    setError(null);
    try {
      // A locked one playing (issue #145) plays on, the take with it.
      await apiClient.useTake(songVersionId, take.id, playing && !playing.locked ? playing.id : null);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }
  const shown = attachments.filter((a) => (kind === "audio" ? a.type === "AUDIO" : a.type !== "AUDIO"));
  // Audio not part of any multitrack: recordings of the whole song.
  const inMultitrack = new Set(multitracks.flatMap((multitrack) => [...multitrack.files, ...multitrack.otherTakes].map((file) => file.id)));
  const loose = shown.filter((file) => !inMultitrack.has(file.id));

  useEffect(() => {
    apiClient
      .getMyStorage()
      .then(setUsage)
      .catch(() => {});
  }, [attachments.length]);
  useEffect(() => {
    apiClient
      .listTeams()
      .then(setTeams)
      .catch(() => {});
  }, []);

  async function upload(files: File[]) {
    setError(null);
    for (const file of files) {
      const fileType = kind === "audio" ? "AUDIO" : type === "AUTO" ? attachmentTypeFor(file) : type;
      // Some browsers give an .opus file no type: its name says it's audio.
      if (kind === "audio" && !file.type.startsWith("audio/") && !isAudioFilename(file.name)) {
        setError(t("songEditor.notAudio", { name: file.name }));
        continue;
      }
      const sentAs = fileType === "AUDIO" && kind === "files" ? "OTHER" : fileType;
      const limitMb = limitsMb?.[sentAs];
      if (limitMb && file.size > limitMb * 1024 * 1024) {
        setError(t("songEditor.fileTooLarge", { name: file.name, type: t(`songEditor.fileTypes.${sentAs}`), mb: limitMb }));
        continue;
      }
      setUploading(file.name);
      try {
        // "Song - Vocals.mp3" is the vocals stem (issue #64); the part can be changed below the file.
        const stemPart = kind === "audio" ? stemPartFromFilename(file.name) : null;
        await apiClient.uploadAttachment(songVersionId, sentAs, file, stemPart, audience);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    setUploading(null);
    await router.invalidate();
  }

  async function download(attachment: Attachment, original = false) {
    setBusyId(attachment.id);
    setError(null);
    try {
      const blob = original ? await apiClient.downloadAttachmentOriginal(songVersionId, attachment.id) : await apiClient.downloadAttachment(songVersionId, attachment.id);
      downloadBlob(blob, original ? attachment.filename.replace(/\.[a-z0-9]{1,5}$/i, "") + ".flac" : attachment.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  /** Saves a change to one or more audio files at once (all the stems share their recording's key and tempo). */
  async function update(files: Attachment[], change: Parameters<typeof apiClient.updateAttachment>[2]) {
    setBusyId(files[0]?.id ?? null);
    setError(null);
    try {
      await Promise.all(files.map((file) => apiClient.updateAttachment(songVersionId, file.id, change)));
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(attachment: Attachment) {
    setBusyId(attachment.id);
    setError(null);
    try {
      await apiClient.deleteAttachment(songVersionId, attachment.id);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t(kind === "audio" ? "songEditor.tabs.audio" : "songEditor.tabs.files")}</CardTitle>
          <CardDescription>{t(kind === "audio" ? "songEditor.audioDescription" : "songEditor.filesDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(kind === "audio" ? "songEditor.noAudio" : "songEditor.noFiles")}</p>
          ) : (
            <>
            {kind === "audio" ? (
              // Each multitrack's files in its box (issue #175): its stems, then the recordings people made into it.
              <div className="flex flex-col gap-4" data-testid="audio-list">
                {multitracks.map((multitrack, index) => {
                  const files = [...multitrack.files, ...multitrack.otherTakes];
                  const own = files.filter((file) => file.origin !== "RECORDED");
                  const recorded = files.filter((file) => file.origin === "RECORDED");
                  return (
                    <MultitrackBox
                      key={multitrack.id ?? ""}
                      multitrack={multitrack}
                      index={index}
                      songKey={songKey}
                      songTempo={songTempo}
                      separation={multitrack.id ? separations.find((item) => item.multitrackId === multitrack.id) : undefined}
                      busy={busyId !== null}
                      onChange={(changed, change) => void update(changed, change)}
                      onRecord={() => setRecording({ target: multitrack.id ?? "" })}
                    >
                      {own.length > 0 ? <ul className="flex flex-col divide-y border-t pt-2">{own.map((file) => fileRow(file))}</ul> : null}
                      {recorded.length > 0 ? (
                        <div className="flex flex-col gap-1 border-t pt-2" data-testid="multitrack-recordings">
                          <p className="text-xs font-medium text-muted-foreground">{t("stems.recordings")}</p>
                          <ul className="flex flex-col divide-y">{recorded.map((file) => fileRow(file, true))}</ul>
                        </div>
                      ) : null}
                    </MultitrackBox>
                  );
                })}
                {/* Recordings on their own (a full mix): not part of a multitrack. */}
                {loose.length > 0 ? <ul className="flex flex-col divide-y">{loose.map((file) => fileRow(file, file.origin === "RECORDED"))}</ul> : null}
              </div>
            ) : (
              <ul className="flex flex-col divide-y" data-testid={`${kind}-list`}>
                {shown.map((attachment) => fileRow(attachment))}
              </ul>
            )}
            </>
          )}
          <SeparationList separations={separations} attachments={attachments} busy={busyId !== null} onRetry={(id) => void retrySeparation(id)} />
          {kind === "audio" ? <p className="text-xs text-muted-foreground">{t("stems.detectHint")}</p> : null}
          {/* Takes of this song not on the server yet (issue #365): waiting to upload, or cut short. */}
          {kind === "audio" ? <StoredTakes songVersionId={songVersionId} onUploaded={() => void router.invalidate()} /> : null}
          {/* The first layer of a song, or another version of it: a new multitrack, with the metronome only (#123). */}
          {kind === "audio" ? (
            <Button type="button" variant="outline" className="self-start" onClick={() => setRecording({ target: NEW_TARGET })} disabled={busyId !== null} data-testid="record-new">
              <Mic />
              {t("recorder.recordNew")}
            </Button>
          ) : null}
          {recording ? (
            <RecordScreen
              songVersionId={songVersionId}
              songTitle={songTitle}
              multitracks={multitracks}
              target={recording.target}
              songTempo={songTempo ? Number(songTempo) : null}
              songTimeSignature={songTimeSignature}
              songBeats={songMetronomeBeats ? (songMetronomeBeats.split(",") as BeatLevel[]) : null}
              songKey={songKey}
              cueSections={cueSections}
              onClose={() => setRecording(null)}
              onSaved={() => void router.invalidate()}
            />
          ) : null}
          {kind === "audio" && mode !== "practice" && stems.length > 0 ? (
            <Button type="button" variant="link" className="h-auto self-start p-0" onClick={() => setMode("practice")}>
              {t("stems.practiceHint")}
            </Button>
          ) : null}
          {error ? (
            <FieldError>
              {error}
            </FieldError>
          ) : null}
        </CardContent>
      </Card>

      {/* Anyone who sees the song adds files of their own to it (issue #72) - audio files, with a role that allows it (#183). */}
      {kind === "audio" && !canUploadAudio ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground" data-testid="audio-uploads-off">
              {t("songEditor.audioUploadsOff")}
            </p>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm transition-colors hover:border-primary/60 hover:bg-muted/40",
              dragging ? "border-primary bg-primary/5" : "border-input",
            )}
            // The whole box opens the file picker, not only "browse" (its button and the input handle their own clicks).
            onClick={(event) => {
              if (!(event.target as HTMLElement).closest("button, a, input, label, select")) inputRef.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void upload([...event.dataTransfer.files]);
            }}
          >
            <Upload className="size-5 text-muted-foreground" aria-hidden />
            <p>
              {t(kind === "audio" ? "songEditor.dropAudio" : "songEditor.dropFiles")}{" "}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => inputRef.current?.click()}>
                {t("songEditor.browse")}
              </button>
            </p>
            <p className="text-xs text-muted-foreground">{kind === "audio"
                ? t("songEditor.audioLimit", { mb: limitsMb?.AUDIO ?? 50 })
                : t("songEditor.filesLimit", { mb: filesLimitMb ?? 25 })}</p>
            {!canEdit ? <p className="text-xs text-muted-foreground">{t("fileVisibility.ownHint")}</p> : null}
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={kind === "audio" ? "audio/*,.opus,.ogg,.mp3,.m4a,.wav,.flac" : undefined}
              className="sr-only"
              aria-label={t(kind === "audio" ? "songEditor.uploadAudio" : "songEditor.uploadFiles")}
              data-testid={`${kind}-input`}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                if (files.length) void upload(files);
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-4">
              {kind === "files" ? (
                <label className="flex items-center gap-2 text-sm">
                  {t("songEditor.fileType")}
                  <NativeSelect value={type} onChange={(event) => setType(event.target.value as AttachmentType | "AUTO")}>
                    <option value="AUTO">{t("songEditor.fileTypeAuto")}</option>
                    {FILE_TYPES.map((option) => (
                      <option key={option} value={option}>
                        {t(`songEditor.fileTypes.${option}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                {t("fileVisibility.label")}
                <AudienceSelect
                  value={audience}
                  teams={teams}
                  canShowToSong={canEdit}
                  canShowToShared={canShare}
                  label={t("fileVisibility.forNew")}
                  onChange={setAudience}
                />
              </label>
            </div>
            {uploading ? (
              <span className="text-sm text-muted-foreground" role="status">
                {t("songEditor.uploading", { name: uploading })}
              </span>
            ) : usage ? (
              <span className="text-xs text-muted-foreground">
                {usage.limitBytes === null
                  ? t("songEditor.storageUsedUnlimited", { used: formatBytes(usage.usedBytes) })
                  : t("songEditor.storageUsed", { used: formatBytes(usage.usedBytes), limit: formatBytes(usage.limitBytes) })}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
