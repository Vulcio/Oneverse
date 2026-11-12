import type { LibraryHome, SongVersionSummary } from "@oneverse/core";
import { Link, useRouter } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Lock, Maximize2, Music2, Star } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";
import { AddToSetIconButton } from "#/components/add-to-set";
import { FavoriteButton } from "#/components/favorite-button";
import { SongPeek } from "#/components/song-peek";
import { useIsFavorite } from "#/lib/favorites";
import { coverColors, initialsOf } from "#/lib/song-cover";

/** A song as a card shows it; `imageUrl` for when songs have images of their own. */
type CardSong = Pick<SongVersionSummary, "id" | "title" | "artists"> & Partial<Pick<SongVersionSummary, "isFavorite" | "tags" | "songbookReferences" | "versionName">> & { workId?: string; imageUrl?: string | null; private?: boolean };

/**
 * A song's cover (issue #81): its image, once songs have one; until then, a
 * cover of its own - a colour from its title, and its initials - so a
 * shelf never shows an empty box.
 */
export function SongCover({ song, className, size = "card" }: { song: CardSong; className?: string; size?: "card" | "small" | "large" }) {
  if (!song.private) return <CoverImage song={song} className={className} size={size} />;
  // Only its owner can see it (issue #172): a lock in a corner.
  return (
    <span className="relative block w-full">
      <CoverImage song={song} className={className} size={size} />
      <PrivateMark className={cn("absolute rounded-full bg-black/55 text-white", size === "small" ? "-top-1 -right-1 p-0.5" : "top-1.5 right-1.5 p-1")} iconClassName={size === "small" ? "size-2.5" : "size-3.5"} />
    </span>
  );
}

/** "Private - only you can see it" (issue #172): a lock, with its words on hover and for screen readers. */
export function PrivateMark({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("inline-flex items-center", className)} title={t("library.private")} data-testid="private-mark">
      <Lock className={cn("size-3.5", iconClassName)} aria-hidden />
      <span className="sr-only">{t("library.private")}</span>
    </span>
  );
}

function CoverImage({ song, className, size }: { song: CardSong; className?: string; size: "card" | "small" | "large" }) {
  const width = size === "small" ? 64 : size === "large" ? 640 : 320;
  if (song.imageUrl) {
    return <img src={`${song.imageUrl}&w=${width}`} alt="" loading="lazy" data-testid="song-image" className={cn("aspect-square w-full rounded-lg object-cover", className)} />;
  }
  const [from, to] = coverColors(song.title);
  return (
    <div
      aria-hidden
      data-testid="song-cover"
      className={cn("relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg text-white", className)}
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {size === "small" ? (
        <span className="text-[0.625rem] font-semibold">{initialsOf(song.title)}</span>
      ) : (
        <>
          <span className={cn("font-semibold tracking-tight drop-shadow-sm", size === "large" ? "text-5xl" : "text-3xl")}>{initialsOf(song.title) || <Music2 className="size-8" />}</span>
          <Music2 className="absolute right-2 bottom-2 size-4 opacity-60" />
        </>
      )}
    </div>
  );
}

/** How long a finger stays on a card before its preview opens (ms), and how far it may move meanwhile (px). */
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

/** A small round button over a card's cover. */
const CARD_ACTION = "flex size-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-sm outline-none hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5";

/** What comes over a card's cover with the mouse or the keyboard, or while its set picker is open. */
const CARD_HOVER = "opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100 has-[[aria-expanded=true]]:opacity-100";

/**
 * A song on a shelf: its cover and name open it. With a mouse or the
 * keyboard, three small buttons come over the cover (issue #434): star it,
 * add it to a set, look at it without leaving (`onPeek`). A touch screen has
 * no hover: a long press opens that preview, where the same actions are.
 */
function SongCard({ song, from, onPeek, onFavoriteChange }: { song: CardSong; from?: string; onPeek: () => void; onFavoriteChange: () => void }) {
  const { t } = useTranslation();
  const artists = song.artists.map((artist) => artist.source).filter(Boolean).join(", ");
  const favorite = useIsFavorite(song.id, !!song.isFavorite);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  // A long press opened the preview: the click that ends it isn't the link's.
  const pressed = useRef(false);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);
  return (
    <div
      className="group/card relative w-36 shrink-0 snap-start [-webkit-touch-callout:none] sm:w-40"
      data-testid="song-card"
      data-song={song.id}
      onPointerDown={(event) => {
        pressed.current = false;
        if (event.pointerType !== "touch") return;
        cancelPress();
        press.current = {
          x: event.clientX,
          y: event.clientY,
          timer: setTimeout(() => {
            press.current = null;
            pressed.current = true;
            onPeek();
          }, LONG_PRESS_MS),
        };
      }}
      onPointerMove={(event) => {
        if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > LONG_PRESS_SLOP) cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(event) => {
        // A touch screen's own menu for a long press on a link: the preview has what one wants there.
        if (pressed.current || press.current) event.preventDefault();
      }}
      onClickCapture={(event) => {
        if (!pressed.current) return;
        pressed.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Link
        to="/library/$songVersionId"
        params={{ songVersionId: song.id }}
        search={from ? { from } : {}}
        className="flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        draggable={false}
      >
        <SongCover song={song} className="transition-transform group-hover/card:scale-[1.02]" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium group-hover/card:underline">{song.title}</span>
          {artists ? <span className="truncate text-xs text-muted-foreground">{artists}</span> : null}
        </span>
      </Link>
      {/* Over the cover's top left (the lock of a private song is on its right). The star stays once the song is a
          favorite (issue #445); the rest come with the mouse or the keyboard. Not on a touch screen: see the long press. */}
      <div className="absolute top-1.5 left-1.5 flex items-center gap-1" data-testid="song-card-actions">
        <div className={cn("hidden can-hover:block", favorite ? undefined : CARD_HOVER)} data-testid="song-card-star">
          <FavoriteButton songVersionId={song.id} initial={!!song.isFavorite} variant="card" onChange={onFavoriteChange} />
        </div>
        <div className={cn("hidden items-center gap-1 can-hover:flex", CARD_HOVER)} data-testid="song-card-more">
          <AddToSetIconButton songVersionId={song.id} songTitle={song.title} className={CARD_ACTION} testId="song-card-add-to-set" />
          <button type="button" className={CARD_ACTION} aria-label={t("library.peek.expand")} title={t("library.peek.expand")} onClick={onPeek} data-testid="song-card-expand">
            <Maximize2 />
          </button>
        </div>
        {favorite ? (
          // A touch screen's star: shown, not pressed (the long press's preview has the button).
          <span className={cn(CARD_ACTION, "can-hover:hidden")} data-testid="song-card-favorite-mark">
            <Star className="fill-amber-400 text-amber-500" aria-hidden />
            <span className="sr-only">{t("library.home.favorites")}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Whether a shelf can scroll back or on (issue #94), kept up to date as it
 * scrolls or its width changes.
 */
function useScrollEnds() {
  const ref = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ back: false, on: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const back = el.scrollLeft > 1;
    const on = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEnds((was) => (was.back === back && was.on === on ? was : { back, on }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [update]);
  const scroll = (direction: 1 | -1) => ref.current?.scrollBy({ left: direction * ref.current.clientWidth * 0.9, behavior: "smooth" });
  return { ref, ends, scroll };
}

function Shelf({ id, title, songs, more, from }: { id: string; title: string; songs: CardSong[]; more?: ReactNode; from?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { ref, ends, scroll } = useScrollEnds();
  // The song looked at without leaving the shelf (issue #434), by its place in it.
  const [peek, setPeek] = useState<string | null>(null);
  const peekIndex = peek === null ? -1 : songs.findIndex((song) => song.id === peek);
  // A star given or taken: the Favorites shelf follows.
  const refresh = () => void router.invalidate();
  // Its songs in another order (a song just opened leads Recently viewed): back to the start. Otherwise the browser
  // keeps the card that was first in place (scroll snapping), pushing the new first one out past the column's edge.
  const order = songs.map((song) => song.id).join();
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollLeft = 0;
  }, [order]);
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`shelf-${id}`} data-testid={`shelf-${id}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={`shelf-${id}`} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {more}
          {ends.back || ends.on ? (
            // Touch screens swipe: the buttons are for a mouse (issue #94).
            <div className="hidden items-center gap-1 [@media(any-pointer:fine)]:flex">
              <Button variant="outline" size="icon" className="size-7 rounded-full" disabled={!ends.back} onClick={() => scroll(-1)} aria-label={t("library.home.scrollBack", { title })} data-testid="shelf-back">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="icon" className="size-7 rounded-full" disabled={!ends.on} onClick={() => scroll(1)} aria-label={t("library.home.scrollOn", { title })} data-testid="shelf-on">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <div ref={ref} data-testid="shelf-row" className="bleed-x flex snap-x gap-4 overflow-x-auto pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {songs.map((song) => (
          <SongCard key={song.id} song={song} from={from} onPeek={() => setPeek(song.id)} onFavoriteChange={refresh} />
        ))}
      </div>
      <SongPeek
        songs={songs}
        index={peekIndex < 0 ? null : peekIndex}
        onIndexChange={(index) => setPeek(songs[index]?.id ?? null)}
        onClose={() => setPeek(null)}
        from={from}
        onFavoriteChange={refresh}
        finalFocus={(id) => {
          // Back on the card of the song last shown, scrolled to.
          const link = ref.current?.querySelector<HTMLElement>(`[data-song="${CSS.escape(id)}"] a`) ?? null;
          link?.scrollIntoView({ block: "nearest", inline: "nearest" });
          return link;
        }}
      />
    </section>
  );
}

function SeeAll({ children, ...link }: { children: ReactNode; search: Record<string, string | boolean> }) {
  return (
    <Link to="/library/songs" search={link.search} className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground">
      {children}
      <ChevronRight className="size-4" />
    </Link>
  );
}

/**
 * The Library's home (issue #81), above its list: newly added, recently
 * viewed, favorites and what's popular in the user's teams. A shelf with
 * nothing on it isn't shown.
 */
export function LibraryShelves({ home }: { home: LibraryHome }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-8" data-testid="library-home">
      {home.newest.length > 0 ? (
        <Shelf id="newest" title={t("library.home.newest")} songs={home.newest} from="sort=createdAt&dir=desc" more={<SeeAll search={{ sort: "createdAt", dir: "desc" }}>{t("library.home.seeAll")}</SeeAll>} />
      ) : null}
      {home.recent.length > 0 ? <Shelf id="recent" title={t("library.home.recent")} songs={home.recent} /> : null}
      {home.favorites.length > 0 ? (
        <Shelf id="favorites" title={t("library.home.favorites")} songs={home.favorites} from="favorites=true" more={<SeeAll search={{ favorites: true }}>{t("library.home.seeAll")}</SeeAll>} />
      ) : null}
      {home.popular.length > 0 ? <Shelf id="popular" title={t("library.home.popular")} songs={home.popular} /> : null}
    </div>
  );
}
