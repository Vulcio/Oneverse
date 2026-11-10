import type { SetForSong } from "@oneverse/core";
import { toast } from "@oneverse/ui/components/toast";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type DragEvent, type HTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { useAddSongToSet } from "#/components/set-team-access";
import { apiClient } from "#/lib/api-client";
import { setlistTitle } from "#/lib/setlists";
import { carriesSong, SONG_DRAG_TYPE, useDraggedSong } from "#/lib/song-drag";
import { addToQuickSelection, inQuickSelection, useQuickSelection } from "#/lib/quick-selection";

const QUICK = "quick-selection";

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
 * to it first, issue #331; `dialog` asks, in the page). What came of it is a
 * toast, with the set to open.
 */
export function useSetDrop() {
  const { t, i18n } = useTranslation();
  const dragged = useDraggedSong();
  const [sets, setSets] = useState<Map<string, SetForSong> | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const navigate = useNavigate();
  const dropped = useRef("");
  const adding = useAddSongToSet((set) =>
    toast.success(t("sets.dropOnSet.added", { song: dropped.current, set: setlistTitle(set, t, i18n.language) }), {
      action: { label: t("sets.dropOnSet.open"), onClick: () => void navigate({ to: "/sets/$setlistId", params: { setlistId: set.id } }) },
    }),
  );
  const quick = useQuickSelection();

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
    if (failed) toast.error(failed);
  }

  /** What makes an entry a place to drop the song, under `key`. */
  function dropProps(key: string, onDrop: (songVersionId: string, songTitle: string) => void): HTMLAttributes<HTMLElement> {
    const title = dragged?.title ?? "";
    return {
      onDragOver: (event: DragEvent) => {
        if (!carriesSong(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(key);
      },
      onDragLeave: () => setOver((current) => (current === key ? null : current)),
      onDrop: (event: DragEvent) => {
        const songVersionId = event.dataTransfer.getData(SONG_DRAG_TYPE);
        if (!songVersionId) return;
        event.preventDefault();
        onDrop(songVersionId, title);
      },
    };
  }

  /** A set's state and what makes its entry a place to drop, while a song is dragged. */
  function target(setId: string): SetDropTarget | undefined {
    if (!dragged) return undefined;
    if (!sets) return { state: "loading", over: false, props: {} };
    const set = sets.get(setId);
    const state: DropState = !set || !set.canAddSong ? "refused" : set.hasSong ? "in" : "addable";
    if (state !== "addable") return { state, over: false, props: {} };
    return { state, over: over === setId, props: dropProps(setId, (songVersionId, title) => void drop(set!, songVersionId, title)) };
  }

  /** The Quick selection's entry (issue #334): any song you can see goes in, once. */
  function quickTarget(): SetDropTarget | undefined {
    if (!dragged) return undefined;
    if (!quick) return { state: "loading", over: false, props: {} };
    if (inQuickSelection(quick, dragged.id)) return { state: "in", over: false, props: {} };
    return {
      state: "addable",
      over: over === QUICK,
      props: dropProps(QUICK, (songVersionId, title) =>
        void addToQuickSelection(songVersionId)
          .then(() =>
            toast.success(t("sets.dropOnSet.added", { song: title, set: t("quickSelection.title") }), {
              action: { label: t("sets.addToSet.open"), onClick: () => void navigate({ to: "/quick-selection" }) },
            }),
          )
          .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err))),
      ),
    };
  }

  return { dragging: !!dragged, target, quickTarget, dialog: adding.dialog };
}
