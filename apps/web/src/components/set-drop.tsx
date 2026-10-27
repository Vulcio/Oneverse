import type { SetForSong } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type DragEvent, type HTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { useAddSongToSet } from "#/components/set-team-access";
import { apiClient } from "#/lib/api-client";
import { setlistTitle } from "#/lib/setlists";
import { carriesSong, SONG_DRAG_TYPE, useDraggedSong } from "#/lib/song-drag";

/** What came of a drop, said in the sidebar for a moment. */
export type DropNotice = { setId: string; text: string } | { error: string };

/** How a set in the sidebar takes a song being dragged: it can, it has it, it can't, or not known yet. */
export type DropState = "addable" | "in" | "refused" | "loading";

export interface SetDropTarget {
  state: DropState;
  /** The song is held over it. */
  over: boolean;
  props: HTMLAttributes<HTMLElement>;
}

/**
 * Sets in the sidebar as places to drop a song dragged from the library
 * (issue #330). While one is dragged, each set says whether it takes it -
 * the sets of a song's Add to set do; one it's in already, one it can't go
 * in, or one you can't change don't - and dropping it on one puts it at the
 * set's end (one of your own on a team's set: shared with the team or moved
 * to it first, issue #331; `dialog` asks, in the page).
 */
export function useSetDrop() {
  const { t, i18n } = useTranslation();
  const dragged = useDraggedSong();
  const [sets, setSets] = useState<Map<string, SetForSong> | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [notice, setNotice] = useState<DropNotice | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);
  const dropped = useRef("");
  const adding = useAddSongToSet((set) => setNotice({ setId: set.id, text: t("sets.dropOnSet.added", { song: dropped.current, set: setlistTitle(set, t, i18n.language) }) }));

  useEffect(() => {
    setSets(null);
    setOver(null);
    if (!dragged) return;
    let cancelled = false;
    apiClient
      .setsForSong(dragged.id)
      .then((found) => !cancelled && setSets(new Map(found.map((set) => [set.id, set]))))
      .catch(() => !cancelled && setSets(new Map()));
    return () => {
      cancelled = true;
    };
  }, [dragged]);

  async function drop(set: SetForSong, songVersionId: string, songTitle: string) {
    dropped.current = songTitle;
    const failed = await adding.add(set, songVersionId, songTitle);
    if (failed) setNotice({ error: failed });
  }

  /** A set's state and what makes its entry a place to drop, while a song is dragged. */
  function target(setId: string): SetDropTarget | undefined {
    if (!dragged) return undefined;
    if (!sets) return { state: "loading", over: false, props: {} };
    const set = sets.get(setId);
    const state: DropState = !set || !set.canAddSong ? "refused" : set.hasSong ? "in" : "addable";
    if (state !== "addable") return { state, over: false, props: {} };
    const title = dragged.title;
    return {
      state,
      over: over === setId,
      props: {
        onDragOver: (event: DragEvent) => {
          if (!carriesSong(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setOver(setId);
        },
        onDragLeave: () => setOver((current) => (current === setId ? null : current)),
        onDrop: (event: DragEvent) => {
          const songVersionId = event.dataTransfer.getData(SONG_DRAG_TYPE);
          if (!songVersionId) return;
          event.preventDefault();
          void drop(set!, songVersionId, title);
        },
      },
    };
  }

  return { dragging: !!dragged, target, notice, closeNotice, dialog: adding.dialog };
}

/** What came of the last drop, with the set to open; gone after a few seconds. */
export function DropNoticeBar({ notice, onClose }: { notice: DropNotice; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [notice, onClose]);
  return (
    <div role="status" className="mx-2 flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs" data-testid="set-drop-notice">
      {"error" in notice ? (
        <span className="min-w-0 flex-1 text-destructive">{notice.error}</span>
      ) : (
        <>
          <span className="min-w-0 flex-1">{notice.text}</span>
          <Link to="/sets/$setlistId" params={{ setlistId: notice.setId }} className="shrink-0 font-medium underline-offset-2 hover:underline" onClick={onClose}>
            {t("sets.dropOnSet.open")}
          </Link>
        </>
      )}
    </div>
  );
}
