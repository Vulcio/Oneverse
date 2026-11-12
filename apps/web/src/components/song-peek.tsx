import { resolveTranslation, sectionName, type LocaleValue, type SongVersionDetail, type SongVersionSummary } from "@oneverse/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Headphones, Square } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@oneverse/ui/components/dialog";
import { Kbd } from "@oneverse/ui/components/kbd";
import { Skeleton } from "@oneverse/ui/components/skeleton";
import { toast } from "@oneverse/ui/components/toast";
import { cn } from "@oneverse/ui/lib/utils";
import { AddToSetButton } from "#/components/add-to-set";
import { FavoriteButton } from "#/components/favorite-button";
import { SongCover } from "#/components/library-home";
import { RecordingListen, YouTubeListen, type ListenSource } from "#/components/quick-listen";
import { apiClient } from "#/lib/api-client";
import { setFavorite, useIsFavorite } from "#/lib/favorites";
import { wholeRecordingOf } from "#/lib/stem-files";

/** A song as a shelf has it: enough for its cover and name while the rest is fetched. */
export type PeekSong = Pick<SongVersionSummary, "id" | "title" | "artists"> & Partial<Pick<SongVersionSummary, "imageUrl" | "private" | "isFavorite" | "tags" | "songbookReferences" | "versionName">>;

/** A swipe this long (px), and more across than down, turns the page. */
const SWIPE = 48;
/** The most lines of the chorus shown (the box is as tall whatever the song). */
const LINES = 7;

/** A key's hint, beside what it does: only where there's a keyboard to press it. */
function KeyHint({ children }: { children: string }) {
  return <Kbd className="hidden can-hover:inline-flex">{children}</Kbd>;
}

/**
 * A song at a glance (issues #434, #445), over the Library: its cover, what
 * it's in (key, tempo, time), its tags, its chorus - and what one does with a
 * song before opening it: star it, add it to a set, listen to it, open it.
 * The songs are the shelf's: previous and next by their buttons, the arrow
 * keys, or a swipe on a touch screen. On a touch screen this is where a
 * card's actions are (a long press on the card opens it).
 *
 * Every part keeps its size from one song to the next (skeletons while one
 * loads, its neighbours fetched ahead), so the buttons stay where the thumb is.
 */
export function SongPeek({ songs, index, onIndexChange, onClose, from, onFavoriteChange, finalFocus }: {
  songs: PeekSong[];
  /** The song shown, or null: closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** The list the song is opened from, for its page's sidebar (as a card's link has it). */
  from?: string;
  onFavoriteChange?: () => void;
  /** Where the focus goes back to once it's closed: the card of the song last shown. */
  finalFocus?: (songVersionId: string) => HTMLElement | null;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const song = index === null ? null : (songs[index] ?? null);
  const data = usePeekData(song?.id ?? null);
  const detail = data?.detail ?? null;
  const favorite = useIsFavorite(song?.id ?? "", detail?.isFavorite ?? !!song?.isFavorite);
  // Listening goes on from song to song until it's turned off (or the preview closed).
  const [listening, setListening] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const lastShown = useRef<string | null>(null);
  if (song) lastShown.current = song.id;

  // The songs either side, fetched and their covers loaded ahead: the next one is there at once.
  const prefetch = usePrefetch();
  useEffect(() => {
    if (index === null) return;
    for (const near of [songs[index + 1], songs[index - 1]]) if (near) prefetch(near);
  }, [index, songs, prefetch]);

  useEffect(() => {
    if (index === null) setListening(false);
  }, [index]);

  const go = (step: number) => {
    if (index === null || songs.length === 0) return;
    const next = Math.max(0, Math.min(songs.length - 1, index + step));
    if (next !== index) onIndexChange(next);
  };
  const open = () => {
    if (!song) return;
    void navigate({ to: "/library/$songVersionId", params: { songVersionId: song.id }, search: from ? { from } : {} });
  };
  const toggleFavorite = () => {
    if (!song) return;
    setFavorite(song.id, !favorite)
      .then(() => onFavoriteChange?.())
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)));
  };
  const listen = data?.listen ?? null;

  // The keys, wherever the focus is in the preview (a button that just went off loses it), unless
  // something there takes them itself: a field, a list, the set picker, the audio's bar.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable], [role=listbox], [role=menu], [data-testid=add-to-set-list]")) return;
    // On a button or a link, Enter and Space are theirs.
    const onControl = !!target?.closest("button, a");
    const act: Record<string, (() => void) | undefined> = {
      ArrowRight: () => go(1),
      ArrowLeft: () => go(-1),
      ArrowDown: () => go(1),
      ArrowUp: () => go(-1),
      PageDown: () => go(5),
      PageUp: () => go(-5),
      Home: () => go(-songs.length),
      End: () => go(songs.length),
      Enter: onControl ? undefined : open,
      f: toggleFavorite,
      l: () => listen && setListening((on) => !on),
    };
    const action = act[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!action || (event.shiftKey && event.key.length > 1)) return;
    event.preventDefault();
    action();
  };
  const shown = song !== null;
  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: KeyboardEvent) => keys.current(event);
    // Before the dialog's own handlers, which keep Home and End from reaching the document.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [shown]);

  const onPointerDown = (event: ReactPointerEvent) => {
    swipe.current = event.pointerType === "touch" ? { x: event.clientX, y: event.clientY } : null;
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  const defaults = detail?.documentJson.defaults;
  const facts = [
    defaults?.key ? `${t("library.peek.key")} ${defaults.key}` : null,
    defaults?.tempo ? t("library.peek.bpm", { tempo: Math.round(defaults.tempo) }) : null,
    defaults?.timeSignature ? `${defaults.timeSignature.numerator}/${defaults.timeSignature.denominator}` : null,
  ].filter((fact) => fact !== null);
  const passage = detail ? chorusOf(detail, (type) => t(`chart.sections.${type}`)) : null;
  const tags = detail?.tags ?? song?.tags ?? [];
  const references = detail?.songbookReferences ?? song?.songbookReferences ?? [];
  const artists = (song?.artists ?? []).map((artist) => artist.source).filter((name): name is string => !!name);
  const versionName = detail?.versionName ?? song?.versionName ?? null;
  const youtube = listening && listen?.kind === "youtube";

  return (
    <Dialog open={shown} onOpenChange={(next) => !next && onClose()}>
      {song && index !== null ? (
        <DialogContent
          ref={popup}
          initialFocus={popup}
          finalFocus={() => (lastShown.current ? (finalFocus?.(lastShown.current) ?? true) : true)}
          // Held from the top, not centred: nothing below moves if something above is taller.
          className="top-[max(1rem,8vh)] translate-y-0 gap-4 touch-pan-y sm:max-w-xl"
          data-testid="song-peek"
          data-song={song.id}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (swipe.current = null)}
        >
          <div className="flex gap-4 pr-6">
            <div className="w-28 shrink-0 sm:w-36">
              <SongCover song={song} className="bg-muted" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <DialogTitle className="line-clamp-2 min-h-[2lh] leading-tight">
                <Link
                  to="/library/$songVersionId"
                  params={{ songVersionId: song.id }}
                  search={from ? { from } : {}}
                  className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="song-peek-title"
                >
                  {song.title}
                </Link>
              </DialogTitle>
              <DialogDescription render={<div />} className="truncate" data-testid="song-peek-artists">
                {artists.length > 0
                  ? artists.map((name, at) => (
                      <Fragment key={`${name}-${at}`}>
                        {at > 0 ? ", " : null}
                        <Link to="/library/artists/$name" params={{ name }} className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring" data-testid="song-peek-artist">
                          {name}
                        </Link>
                      </Fragment>
                    ))
                  : t("library.peek.noArtist")}
                {versionName ? ` · ${versionName}` : null}
              </DialogDescription>
              <div className="h-5 truncate text-sm font-medium tabular-nums" data-testid="song-peek-facts">
                {detail ? facts.join(" · ") : <Skeleton className="h-4 w-36" />}
              </div>
              {/* One row, whatever the song: what doesn't fit is cut. */}
              <div className="flex h-5 flex-wrap gap-1 overflow-hidden">
                {references.map((reference) => (
                  <Badge key={reference} variant="outline">
                    {reference}
                  </Badge>
                ))}
                {tags.slice(0, 6).map((tag) => (
                  <Badge key={tag.id} variant="muted">
                    {resolveTranslation(tag.label, tag.translations, i18n.language as LocaleValue)}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* The chorus - or, listening to a video, the video - in a box as tall for every song. */}
          <div className={cn("relative h-52 overflow-hidden rounded-md", youtube ? "bg-black" : "bg-muted/50 px-3 py-2")} data-testid="song-peek-lines">
            {youtube && listen?.kind === "youtube" ? (
              <YouTubeListen key={listen.videoId} videoId={listen.videoId} title={song.title} />
            ) : detail ? (
              passage ? (
                <>
                  {passage.name ? <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase" data-testid="song-peek-section">{passage.name}</p> : null}
                  {passage.lines.map((line, at) => (
                    <p key={at} className="truncate text-sm leading-relaxed">
                      {line}
                    </p>
                  ))}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("library.peek.noWords")}</p>
              )
            ) : (
              <div className="flex flex-col gap-2.5 py-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}
            {listening && listen?.kind === "recording" ? (
              <div className="absolute inset-x-2 bottom-2">
                <RecordingListen key={listen.attachment.id} songVersionId={song.id} attachment={listen.attachment} />
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <FavoriteButton key={song.id} songVersionId={song.id} initial={detail?.isFavorite ?? !!song.isFavorite} variant="outline" onChange={onFavoriteChange} />
            <AddToSetButton songVersionId={song.id} songTitle={song.title} />
            <Button
              type="button"
              variant="outline"
              disabled={!listen}
              aria-pressed={listening && !!listen}
              onClick={() => setListening((on) => !on)}
              title={data && !listen ? t("library.peek.nothingToHear") : undefined}
              data-testid="song-peek-listen"
            >
              {listening && listen ? <Square /> : <Headphones />}
              <span className="max-sm:sr-only">{listening && listen ? t("library.peek.stop") : t("library.peek.listen")}</span>
              <KeyHint>L</KeyHint>
            </Button>
            <Button className="ml-auto" onClick={open} data-testid="song-peek-open">
              {t("library.peek.open")}
              <KeyHint>↵</KeyHint>
            </Button>
          </div>

          {songs.length > 1 ? (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t pt-3">
              <Button type="button" variant="ghost" className="justify-self-start" disabled={index === 0} onClick={() => go(-1)} data-testid="song-peek-previous">
                <ChevronLeft />
                {t("library.previous")}
                <KeyHint>←</KeyHint>
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums" data-testid="song-peek-position">
                {t("library.peek.position", { at: index + 1, total: songs.length })}
              </span>
              <Button type="button" variant="ghost" className="justify-self-end" disabled={index === songs.length - 1} onClick={() => go(1)} data-testid="song-peek-next">
                <KeyHint>→</KeyHint>
                {t("library.next")}
                <ChevronRight />
              </Button>
            </div>
          ) : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/** What the preview shows of a song beyond what its card has: the song in full, and what a quick listen plays. */
interface PeekData {
  detail: SongVersionDetail;
  listen: ListenSource | null;
}

// Kept for the page's life: going back and forth through a shelf asks once per song.
const peekCache = new Map<string, Promise<PeekData | null>>();
const peekDone = new Map<string, PeekData | null>();

function loadPeek(songVersionId: string): Promise<PeekData | null> {
  let pending = peekCache.get(songVersionId);
  if (!pending) {
    pending = Promise.all([apiClient.getSongVersion(songVersionId), apiClient.listAttachments(songVersionId).catch(() => [])])
      .then(([detail, attachments]): PeekData => {
        const recording = wholeRecordingOf(attachments);
        const videoId = detail.identifiers.find((identifier) => identifier.type === "YOUTUBE")?.value ?? null;
        const listen: ListenSource | null = recording ? { kind: "recording", attachment: recording } : videoId ? { kind: "youtube", videoId } : null;
        return { detail, listen };
      })
      .catch(() => {
        // Its name and cover stay; Open says what's wrong. Asked again next time.
        peekCache.delete(songVersionId);
        return null;
      })
      .then((data) => {
        if (data) peekDone.set(songVersionId, data);
        return data;
      });
    peekCache.set(songVersionId, pending);
  }
  return pending;
}

/** The song's preview data, fetched as it's shown; null while it loads or if it can't be read. */
function usePeekData(songVersionId: string | null): PeekData | null {
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!songVersionId || peekDone.has(songVersionId)) return;
    let live = true;
    void loadPeek(songVersionId).then(() => live && setLoaded((count) => count + 1));
    return () => {
      live = false;
    };
  }, [songVersionId]);
  return songVersionId ? (peekDone.get(songVersionId) ?? null) : null;
}

/** Fetches a song's preview ahead, and its cover, so it's there when it's shown. */
function usePrefetch() {
  const [prefetch] = useState(() => (song: PeekSong) => {
    void loadPeek(song.id);
    if (song.imageUrl) new Image().src = `${song.imageUrl}&w=320`;
  });
  return prefetch;
}

/**
 * The part of a song that says what it is (issue #445): its first chorus,
 * else its first section with words - its name and its lines, as written.
 */
function chorusOf(detail: SongVersionDetail, typeName: (type: string) => string): { name: string | null; lines: string[] } | null {
  const sung = (section: SongVersionDetail["documentJson"]["sections"][number]) => section.lines.filter((line) => line.kind === "lyric" && line.text.trim()).map((line) => line.text.trim());
  const sections = detail.documentJson.sections;
  const section = sections.find((one) => one.type === "chorus" && sung(one).length > 0) ?? sections.find((one) => sung(one).length > 0);
  if (!section) return null;
  return { name: sectionName(section, null, typeName), lines: sung(section).slice(0, LINES) };
}
