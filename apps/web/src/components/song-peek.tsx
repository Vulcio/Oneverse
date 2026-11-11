import { resolveTranslation, type LocaleValue, type SongVersionDetail, type SongVersionSummary } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@oneverse/ui/components/dialog";
import { Skeleton } from "@oneverse/ui/components/skeleton";
import { AddToSetButton } from "#/components/add-to-set";
import { FavoriteButton } from "#/components/favorite-button";
import { SongCover } from "#/components/library-home";
import { apiClient } from "#/lib/api-client";

/** A song as a shelf has it: enough for its cover and name while the rest is fetched. */
export type PeekSong = Pick<SongVersionSummary, "id" | "title" | "artists"> & Partial<Pick<SongVersionSummary, "imageUrl" | "private" | "isFavorite" | "tags" | "songbookReferences" | "versionName">>;

/** A swipe this long (px), and more across than down, turns the page. */
const SWIPE = 48;
/** The first lines shown. */
const LINES = 6;

/**
 * A song at a glance (issue #434), over the Library: its cover, what it's in
 * (key, tempo, time), its tags, its first lines - and what one does with a
 * song before opening it: star it, add it to a set, open it. The songs are
 * the shelf's: previous and next by their buttons, the left and right arrow
 * keys, or a swipe on a touch screen. On a touch screen this is where a
 * card's actions are (a long press on the card opens it).
 */
export function SongPeek({ songs, index, onIndexChange, onClose, from, onFavoriteChange }: {
  songs: PeekSong[];
  /** The song shown, or null: closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** The list the song is opened from, for its page's sidebar (as a card's link has it). */
  from?: string;
  onFavoriteChange?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const song = index === null ? null : (songs[index] ?? null);
  const detail = useSongDetail(song?.id ?? null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const go = (step: 1 | -1) => {
    if (index === null) return;
    const next = index + step;
    if (next >= 0 && next < songs.length) onIndexChange(next);
  };

  // The arrows go through the shelf wherever the focus is (a button that just went off loses it),
  // unless something in the dialog uses them: a list, a field.
  const goRef = useRef(go);
  goRef.current = go;
  const open = song !== null;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], [role=listbox], [role=menu], [data-testid=add-to-set-list]")) return;
      event.preventDefault();
      goRef.current(event.key === "ArrowRight" ? 1 : -1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

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
  const time = defaults?.timeSignature ? `${defaults.timeSignature.numerator}/${defaults.timeSignature.denominator}` : null;
  const facts = [
    defaults?.key ? { label: t("library.peek.key"), value: defaults.key } : null,
    defaults?.tempo ? { label: t("library.peek.tempo"), value: t("library.peek.bpm", { tempo: Math.round(defaults.tempo) }) } : null,
    time ? { label: t("library.peek.time"), value: time } : null,
  ].filter((fact) => fact !== null);
  const lines = detail ? firstLines(detail) : [];
  const tags = detail?.tags ?? song?.tags ?? [];
  const references = detail?.songbookReferences ?? song?.songbookReferences ?? [];
  const artists = (song?.artists ?? []).map((artist) => artist.source).filter(Boolean).join(", ");

  return (
    <Dialog open={song !== null} onOpenChange={(open) => !open && onClose()}>
      {song && index !== null ? (
        <DialogContent
          className="gap-5 touch-pan-y sm:max-w-xl"
          data-testid="song-peek"
          data-song={song.id}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (swipe.current = null)}
        >
          <div className="flex gap-4 pr-6">
            <div className="w-28 shrink-0 sm:w-36">
              <SongCover song={song} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-col gap-1">
                <DialogTitle className="leading-tight text-balance" data-testid="song-peek-title">
                  {song.title}
                </DialogTitle>
                <DialogDescription>{[artists, detail?.versionName ?? song.versionName].filter(Boolean).join(" · ") || t("library.peek.noArtist")}</DialogDescription>
              </div>
              {detail ? (
                facts.length > 0 ? (
                  <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm" data-testid="song-peek-facts">
                    {facts.map((fact) => (
                      <div key={fact.label} className="flex items-baseline gap-1.5">
                        <dt className="text-muted-foreground">{fact.label}</dt>
                        <dd className="font-medium tabular-nums">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null
              ) : (
                <Skeleton className="h-5 w-40" />
              )}
              {tags.length > 0 || references.length > 0 ? (
                <div className="flex flex-wrap gap-1">
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
              ) : null}
            </div>
          </div>

          <div className="min-h-24 rounded-md bg-muted/50 px-3 py-2 text-sm leading-relaxed" data-testid="song-peek-lines">
            {detail ? (
              lines.length > 0 ? (
                lines.map((line, at) => (
                  <p key={at} className="truncate">
                    {line}
                  </p>
                ))
              ) : (
                <p className="text-muted-foreground">{t("library.peek.noWords")}</p>
              )
            ) : (
              <div className="flex flex-col gap-2 py-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FavoriteButton key={song.id} songVersionId={song.id} initial={detail?.isFavorite ?? !!song.isFavorite} variant="outline" onChange={onFavoriteChange} />
            <AddToSetButton songVersionId={song.id} songTitle={song.title} />
            <Button className="ml-auto" render={<Link to="/library/$songVersionId" params={{ songVersionId: song.id }} search={from ? { from } : {}} />} data-testid="song-peek-open">
              {t("library.peek.open")}
            </Button>
          </div>

          {songs.length > 1 ? (
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => go(-1)} data-testid="song-peek-previous">
                <ChevronLeft />
                {t("library.previous")}
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums" data-testid="song-peek-position">
                {t("library.peek.position", { at: index + 1, total: songs.length })}
              </span>
              <Button type="button" variant="ghost" size="sm" disabled={index === songs.length - 1} onClick={() => go(1)} data-testid="song-peek-next">
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

/** The song in full, fetched as it's shown (kept for the songs gone through); null while it loads or if it can't be read. */
function useSongDetail(songVersionId: string | null): SongVersionDetail | null {
  const cache = useRef(new Map<string, SongVersionDetail>());
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!songVersionId || cache.current.has(songVersionId)) return;
    let cancelled = false;
    apiClient
      .getSongVersion(songVersionId)
      .then((detail) => {
        cache.current.set(songVersionId, detail);
        if (!cancelled) setLoaded((count) => count + 1);
      })
      .catch(() => {
        // Its name and cover stay; Open says what's wrong.
      });
    return () => {
      cancelled = true;
    };
  }, [songVersionId]);
  return songVersionId ? (cache.current.get(songVersionId) ?? null) : null;
}

/** The song's first sung lines, as written. */
function firstLines(detail: SongVersionDetail): string[] {
  const lines: string[] = [];
  for (const section of detail.documentJson.sections) {
    for (const line of section.lines) {
      if (line.kind !== "lyric" || !line.text.trim()) continue;
      lines.push(line.text.trim());
      if (lines.length === LINES) return lines;
    }
  }
  return lines;
}
