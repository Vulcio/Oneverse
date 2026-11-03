import { formatDuration } from "@oneverse/core";
import { CloudUpload, Loader2, Pause, Play, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { apiClient } from "#/lib/api-client";
import { deleteStoredTake, isUploadingTake, recoverStoredTake, storedTakeSeconds, uploadStoredTake, type StoredTake } from "#/lib/take-store";
import { useStoredTakes } from "#/lib/waiting-takes";

/**
 * The takes on this device that aren't on the server yet (issue #365): kept
 * and waiting to upload (sent again on their own when the connection is
 * back), or cut short by a reload or a crash - to keep or drop. Each can be
 * heard first. Nothing shows when there are none.
 */
export function StoredTakes({ songVersionId, onUploaded }: { songVersionId: string; onUploaded?: () => void }) {
  const { t, i18n } = useTranslation();
  const takes = useStoredTakes(songVersionId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);

  useEffect(
    () => () => {
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  if (takes.length === 0) return null;

  function stopPlaying() {
    audio.current?.pause();
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setPlaying(null);
  }

  async function ready(take: StoredTake): Promise<StoredTake | null> {
    return take.state === "recording" ? recoverStoredTake(take.id) : take;
  }

  async function play(take: StoredTake) {
    if (playing === take.id) return stopPlaying();
    stopPlaying();
    const kept = await ready(take);
    if (!kept?.wav) return;
    url.current = URL.createObjectURL(kept.wav);
    const element = audio.current ?? new Audio();
    audio.current = element;
    element.src = url.current;
    element.onended = () => setPlaying(null);
    setPlaying(take.id);
    await element.play().catch(() => setPlaying(null));
  }

  async function upload(take: StoredTake) {
    setBusy(take.id);
    setError(null);
    try {
      const kept = await ready(take);
      if (!kept) return;
      await uploadStoredTake(kept, apiClient);
      onUploaded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function discard(take: StoredTake) {
    if (playing === take.id) stopPlaying();
    await deleteStoredTake(take.id);
  }

  const time = (at: number) => new Date(at).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
  const day = (at: number) => new Date(at).toLocaleDateString(i18n.language, { day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3" data-testid="stored-takes">
      <p className="text-sm font-medium">{t("recorder.stored.title", { count: takes.length })}</p>
      <p className="text-xs text-muted-foreground">{t("recorder.stored.description")}</p>
      <ul className="flex flex-col divide-y">
        {takes.map((take) => {
          const seconds = storedTakeSeconds(take);
          const sending = busy === take.id || isUploadingTake(take.id);
          return (
            <li key={take.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="stored-take" data-state={take.state}>
              <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => void play(take)} aria-label={playing === take.id ? t("recorder.stored.pause") : t("recorder.stored.play")}>
                {playing === take.id ? <Pause /> : <Play />}
              </Button>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{take.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[`${day(take.createdAt)} ${time(take.createdAt)}`, seconds !== null ? formatDuration(seconds) : null, take.state === "recording" ? t("recorder.stored.cutShort") : t("recorder.stored.waiting")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {take.error ? (
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <TriangleAlert className="size-3" aria-hidden />
                    {take.error}
                  </span>
                ) : null}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => void upload(take)} disabled={sending} data-testid="stored-take-upload">
                {sending ? <Loader2 className="animate-spin" /> : <CloudUpload />}
                {take.state === "recording" ? t("recorder.stored.keep") : t("recorder.stored.upload")}
              </Button>
              {sending ? null : (
                <span data-testid="stored-take-discard">
                  <ConfirmButton
                    label={
                      <>
                        <Trash2 />
                        {t("recorder.stored.discard")}
                      </>
                    }
                    confirmLabel={t("recorder.stored.discardConfirm")}
                    busyLabel={t("recorder.stored.discarding")}
                    cancelLabel={t("recorder.stored.cancel")}
                    onConfirm={() => discard(take)}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
