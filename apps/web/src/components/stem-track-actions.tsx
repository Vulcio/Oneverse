import { encodeWav, type RecordingDetails } from "@songverse/core";
import { Combine, Loader2, Mic, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { pauseStems, stemMono, stemsAudioContext, TAKE_ID, type StemSong, type StemTrack } from "#/lib/stem-engine";

/** Two takes mixed into one (issue #142): each is silent where the other sings, so they add up; brought down if they'd clip. */
export function mixTakes(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  let loudest = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = (a[i] ?? 0) + (b[i] ?? 0);
    loudest = Math.max(loudest, Math.abs(out[i]!));
  }
  if (loudest > 0.99) for (let i = 0; i < out.length; i++) out[i]! /= loudest / 0.99;
  return out;
}

/**
 * What can be done with a recording in the stem player (issue #142), in a
 * row below it once its name is tapped: record into it (sections punched
 * in), merge another recording of the multitrack into it, or delete it.
 */
export function StemTrackActions({
  song,
  track,
  tracks,
  name,
  nameOf,
  onRecordInto,
  onClose,
}: {
  song: StemSong;
  track: StemTrack;
  tracks: StemTrack[];
  name: string;
  nameOf: (track: StemTrack) => string;
  onRecordInto: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"menu" | "merge" | "delete">("menu");
  // Merged with one sung in the same key: another's pitch would be off.
  const others = tracks.filter((other) => other.id !== track.id && other.id !== TAKE_ID && other.canChange && !!other.mine && !other.locked && !other.failed && other.offset === track.offset);
  const [withId, setWithId] = useState(others[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      song.record?.onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  /** One file of the two, as this one's part: it plays instead of this one, and the two are kept as other takes. */
  const merge = () =>
    run(async () => {
      const file = song.stems.find((stem) => stem.id === track.id);
      const a = stemMono(track.id);
      const b = stemMono(withId);
      const context = stemsAudioContext();
      if (!file || !a || !b || !context) throw new Error(t("stems.mergeNotLoaded"));
      pauseStems();
      const wav = encodeWav(mixTakes(a, b), context.sampleRate);
      const details: RecordingDetails = {
        ...(file.multitrackId ? { multitrackId: file.multitrackId } : {}),
        ...(file.multitrackName ? { multitrackName: file.multitrackName } : {}),
        ...(file.recordingKey ? { recordingKey: file.recordingKey } : {}),
        ...(file.recordingTempo != null ? { recordingTempo: file.recordingTempo } : {}),
        ...(file.recordingTimeSignature ? { recordingTimeSignature: file.recordingTimeSignature } : {}),
        ...(file.recordingFirstBeat != null ? { recordingFirstBeat: file.recordingFirstBeat } : {}),
        ...(file.recordingFreeIntro ? { recordingFreeIntro: true } : {}),
        ...(file.multitrackSetlistId ? { multitrackSetlistId: file.multitrackSetlistId } : {}),
        ...(file.pitchOffset ? { pitchOffset: file.pitchOffset } : {}),
        ...(file.partName ? { partName: file.partName } : {}),
        // Both were cleaned up already: only made Opus.
        process: "encode",
      };
      const upload = new File([wav as Uint8Array<ArrayBuffer>], `${song.title} - ${name}.wav`, { type: "audio/wav" });
      const merged = await apiClient.uploadAttachment(song.songVersionId, "AUDIO", upload, file.stemPart, { visibility: file.visibility, ...(file.visibleToTeam ? { teamId: file.visibleToTeam.id } : {}) }, details);
      await apiClient.useTake(song.songVersionId, merged.id, track.id);
      await apiClient.updateAttachment(song.songVersionId, withId, { otherTake: true });
    });

  const remove = () => run(() => apiClient.deleteAttachment(song.songVersionId, track.id));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs" data-testid="stem-track-actions">
      {mode === "menu" ? (
        <>
          <Button type="button" variant="outline" size="sm" onClick={onRecordInto} data-testid="stem-track-record-into">
            <Mic />
            {t("stems.recordInto")}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={others.length === 0} title={others.length === 0 ? t("stems.mergeNone") : undefined} onClick={() => setMode("merge")} data-testid="stem-track-merge">
            <Combine />
            {t("stems.mergeWith")}
          </Button>
          <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => setMode("delete")} data-testid="stem-track-delete">
            <Trash2 />
            {t("stems.deleteRecording")}
          </Button>
        </>
      ) : mode === "merge" ? (
        <>
          <span>{t("stems.mergeInto", { name })}</span>
          <NativeSelect compact value={withId} onChange={(event) => setWithId(event.target.value)} aria-label={t("stems.mergeWith")} disabled={busy} data-testid="stem-track-merge-with">
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {nameOf(other)}
              </option>
            ))}
          </NativeSelect>
          <Button type="button" size="sm" disabled={busy || !withId} onClick={() => void merge()} data-testid="stem-track-merge-confirm">
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t("stems.merge")}
          </Button>
          <span className="w-full text-muted-foreground">{t("stems.mergeHint")}</span>
        </>
      ) : (
        <>
          <span>{t("stems.deleteConfirm", { name })}</span>
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void remove()} data-testid="stem-track-delete-confirm">
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t("stems.deleteRecording")}
          </Button>
        </>
      )}
      <span className="min-w-0 flex-1" />
      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={mode === "menu" ? onClose : () => setMode("menu")} disabled={busy} aria-label={t("stems.closeActions")}>
        <X />
      </Button>
      {error ? (
        <p className="w-full text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
