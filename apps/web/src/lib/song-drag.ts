import { useSyncExternalStore, type DragEvent } from "react";

/**
 * A song dragged from the library onto a set in the sidebar (issue #330),
 * with the browser's own drag and drop: the song's id rides in the drag
 * under this type, and the song being dragged is kept here so the sidebar
 * can list the sets to drop it on while it's dragged.
 */
export const SONG_DRAG_TYPE = "application/x-oneverse-song";

export interface DraggedSong {
  id: string;
  title: string;
}

let dragged: DraggedSong | null = null;
const listeners = new Set<() => void>();

function set(next: DraggedSong | null) {
  if (dragged === next) return;
  dragged = next;
  for (const listener of listeners) listener();
}

// The drag ends however it ends: dropped anywhere, cancelled, or its row gone from the page.
function ended() {
  set(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("dragend", ended, true);
    window.addEventListener("drop", ended);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("dragend", ended, true);
      window.removeEventListener("drop", ended);
    }
  };
}

/** The song being dragged, if any. */
export function useDraggedSong(): DraggedSong | null {
  return useSyncExternalStore(
    subscribe,
    () => dragged,
    () => null,
  );
}

/** What makes a song's row in a list draggable onto a set. */
export function songDragProps(song: DraggedSong) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(SONG_DRAG_TYPE, song.id);
      event.dataTransfer.setData("text/plain", song.title);
      set(song);
    },
    onDragEnd: ended,
  };
}

/** Whether a drag over something carries a song. */
export const carriesSong = (event: DragEvent) => event.dataTransfer.types.includes(SONG_DRAG_TYPE);
