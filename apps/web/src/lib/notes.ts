import { deviceOffline, isNetworkError, keptSongNotes, type CreateNoteRequest, type NoteAnchor, type NotePlaceChoice, type SongNote, type SongNotes, type UpdateNoteRequest } from "@oneverse/core";
import { useRouteContext } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "#/lib/api-client";
import { deviceStorage } from "#/lib/offline-data";
import { watchSongNotes } from "#/lib/live-notes";

/**
 * Notes on songs (issue #256): what one sees on a song, opened in a set or a
 * songbook (or neither), and changing them. Offline, the notes kept with the
 * song or the set; a note written offline waits on the device (its
 * "outbox") and is sent once the connection is back.
 */

export interface NotesContext {
  songVersionId: string;
  setlistId?: string | null;
  songbookId?: string | null;
}

/** A note written offline, waiting to be sent. */
interface QueuedNote {
  localId: string;
  userId: string;
  createdAt: string;
  body: CreateNoteRequest;
}

const OUTBOX_KEY = "songverse.notes.outbox";

function readOutbox(): QueuedNote[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]") as QueuedNote[];
  } catch {
    return [];
  }
}

function writeOutbox(queue: QueuedNote[]): void {
  try {
    if (queue.length === 0) localStorage.removeItem(OUTBOX_KEY);
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  } catch {
    // Storage full or blocked: the note stays only in this page.
  }
}

// Every hook on the page reloads when a note changes anywhere.
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

let flushing: Promise<void> | null = null;

/** Sends the notes written offline (the signed-in person's), once there's a network. */
export function flushNoteOutbox(userId: string): Promise<void> {
  if (flushing || deviceOffline()) return flushing ?? Promise.resolve();
  flushing = (async () => {
    let sent = false;
    for (const queued of readOutbox().filter((one) => one.userId === userId)) {
      try {
        await apiClient.createNote(queued.body);
      } catch (error) {
        // Still offline: try again later. Refused (the song gone, no right any more): dropped.
        if (isNetworkError(error)) break;
      }
      writeOutbox(readOutbox().filter((one) => one.localId !== queued.localId));
      sent = true;
    }
    if (sent) changed();
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Who wrote what (for the note written offline). */
interface Me {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

/** A queued note as the chart shows it until it's sent. */
function pendingNote(queued: QueuedNote, me: Me, places: NotePlaceChoice[]): SongNote & { pending: true } {
  const place = places.find((one) => one.place === queued.body.place && one.id === (queued.body.teamId ?? queued.body.songbookId ?? (queued.body.place === "SET" ? queued.body.setlistId : null) ?? null));
  return {
    id: queued.localId,
    songVersionId: queued.body.songVersionId,
    content: queued.body.content,
    place: queued.body.place,
    placeId: place?.id ?? null,
    placeName: place?.name ?? null,
    anchor: (queued.body.anchor ?? { kind: "song" }) as NoteAnchor,
    moved: false,
    author: { id: me.userId, displayName: me.displayName, avatarUrl: me.avatarUrl },
    resolved: false,
    createdAt: queued.createdAt,
    updatedAt: queued.createdAt,
    replies: [],
    canEdit: false,
    canReply: false,
    pending: true,
  };
}

/** The body that saves a note in `place`, from where the song was opened. */
export function noteBody(context: NotesContext, place: NotePlaceChoice, content: string, anchor: NoteAnchor, onlyInSet = false): CreateNoteRequest {
  return { songVersionId: context.songVersionId, content, anchor, ...notePlace(context, place, onlyInSet) };
}

/** Where a note is saved, as a request says it: the place, and its team, songbook or set (issue #262: moving one too). */
export function notePlace(context: NotesContext, place: NotePlaceChoice, onlyInSet = false): Pick<CreateNoteRequest, "place" | "teamId" | "songbookId" | "setlistId"> {
  return {
    place: place.place,
    ...(place.place === "TEAM" && { teamId: place.id! }),
    ...(place.place === "SONGBOOK" && { songbookId: place.id! }),
    ...(place.place === "SET" && { setlistId: place.id! }),
    ...(place.place === "ME" && onlyInSet && context.setlistId && { setlistId: context.setlistId }),
  };
}

export type SongNotesState = ReturnType<typeof useSongNotes>;

/** The same notes, as shown: content, places, replies, resolved. */
function sameNotes(a: SongNotes, b: SongNotes): boolean {
  return JSON.stringify(a.notes) === JSON.stringify(b.notes);
}

/**
 * The notes one sees on a song, and what one may do with them. Live (issue
 * #27): someone else's change is read at once - or, with `hold` (Live, where
 * nothing may move under the reader), kept aside as `incoming` until
 * `showIncoming()`.
 */
export function useSongNotes(context: NotesContext, { hold = false }: { hold?: boolean } = {}) {
  const { session } = useRouteContext({ from: "/_protected" });
  const me: Me = { userId: session.userId, displayName: session.displayName, avatarUrl: session.avatarUrl };
  const [data, setData] = useState<SongNotes | null>(null);
  const [incoming, setIncoming] = useState<SongNotes | null>(null);
  const current = useRef<SongNotes | null>(null);
  current.current = data;
  const [kept, setKept] = useState(false);
  const [version, setVersion] = useState(0);
  const { songVersionId, setlistId, songbookId } = context;

  // Another song (the next in a set reuses the page): none of the last one's notes meanwhile.
  const key = `${songVersionId}|${setlistId ?? ""}|${songbookId ?? ""}`;
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) {
    setLoadedKey(key);
    setData(null);
    setIncoming(null);
  }

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        if (deviceOffline()) throw new TypeError("offline");
        const fresh = await apiClient.getSongNotes(songVersionId, { setlistId: setlistId ?? undefined, songbookId: songbookId ?? undefined });
        if (live) {
          setData(fresh);
          setKept(false);
          // What was held is in what was just read (one's own change, heard twice).
          setIncoming((held) => (held && sameNotes(held, fresh) ? null : held));
        }
      } catch (error) {
        // Refused (the song gone, no access): no notes.
        if (!isNetworkError(error)) {
          if (live) setData({ notes: [], places: [] });
          return;
        }
        const copy = await keptSongNotes(deviceStorage(), songVersionId, setlistId).catch(() => undefined);
        if (live) {
          setData(copy ?? { notes: [], places: [{ place: "ME", id: null, name: null }] });
          setKept(true);
        }
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [songVersionId, setlistId, songbookId, version]);

  // Someone else changed the song's notes (issue #27): read again, now or held.
  useEffect(() => {
    if (kept) return;
    return watchSongNotes({ songVersionId, setlistId }, () => {
      apiClient
        .getSongNotes(songVersionId, { setlistId: setlistId ?? undefined, songbookId: songbookId ?? undefined })
        .then((fresh) => {
          const shown = current.current;
          if (shown && sameNotes(shown, fresh)) return setIncoming(null);
          if (hold && shown) setIncoming(fresh);
          else setData(fresh);
        })
        .catch(() => undefined);
    });
  }, [songVersionId, setlistId, songbookId, hold, kept]);

  // Another part of the page changed a note, or the outbox was sent.
  useEffect(() => {
    const listener = () => setVersion((n) => n + 1);
    listeners.add(listener);
    const online = () => void flushNoteOutbox(me.userId);
    window.addEventListener("online", online);
    online();
    return () => {
      listeners.delete(listener);
      window.removeEventListener("online", online);
    };
  }, [me.userId]);

  const queued = readOutbox().filter((one) => one.userId === me.userId && one.body.songVersionId === songVersionId);
  const notes: (SongNote & { pending?: true })[] = [...(data?.notes ?? []), ...queued.map((one) => pendingNote(one, me, data?.places ?? []))];

  const run = useCallback(async (action: () => Promise<unknown>) => {
    await action();
    changed();
  }, []);

  return {
    notes,
    places: data?.places ?? [],
    loaded: data !== null,
    /** Read from the device: changes wait for the network. */
    kept,
    /** Someone else's changes, held (`hold`): show them with showIncoming(). */
    incoming: incoming !== null,
    showIncoming: () => {
      if (incoming) setData(incoming);
      setIncoming(null);
    },
    me: me.userId,
    add: async (body: CreateNoteRequest) => {
      try {
        if (deviceOffline()) throw new TypeError("offline");
        await apiClient.createNote(body);
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        writeOutbox([...readOutbox(), { localId: `local-${Date.now()}`, userId: me.userId, createdAt: new Date().toISOString(), body }]);
      }
      changed();
    },
    update: (noteId: string, patch: UpdateNoteRequest) => run(() => apiClient.updateNote(noteId, patch)),
    remove: (noteId: string) => run(() => apiClient.deleteNote(noteId)),
    reply: (noteId: string, content: string) => run(() => apiClient.replyToNote(noteId, content)),
    updateReply: (noteId: string, replyId: string, content: string) => run(() => apiClient.updateNoteReply(noteId, replyId, content)),
    removeReply: (noteId: string, replyId: string) => run(() => apiClient.deleteNoteReply(noteId, replyId)),
  };
}

const SEEN_KEY = "songverse.notes.seen";
const SEEN_KEPT = 500;

function readSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** A visit to a song being left: written as seen a moment later, unless it's mounted again meanwhile. */
const leaving = new Map<string, { visit: { previous: string | null; opened: string }; timer: ReturnType<typeof setTimeout> }>();

function markSeen(songVersionId: string, at: string) {
  const next = { ...readSeen(), [songVersionId]: at };
  // Only the latest few hundred songs are remembered.
  const kept = Object.entries(next)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, SEEN_KEPT);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage blocked: nothing marked new.
  }
}

/** When a note last moved (written, or replied to), and by whom. */
function lastActivity(note: SongNote): { at: string; by: string } {
  const reply = note.replies.at(-1);
  return reply && reply.createdAt > note.createdAt ? { at: reply.createdAt, by: reply.author.id } : { at: note.createdAt, by: note.author.id };
}

/**
 * Notes new since one last opened the song on this device (issue #27): written
 * or replied to by someone else since then. Opened for the first time,
 * none are; once one leaves it, it counts as seen from when it was opened,
 * so a note arriving live while it's open is new next time too.
 */
export function useNewNotes(songVersionId: string, me: string): (note: SongNote) => boolean {
  const [seenAt, setSeenAt] = useState<{ song: string; at: string | null } | null>(null);
  useEffect(() => {
    // Mounted again at once (the page settling): the same visit, from when it began.
    const back = leaving.get(songVersionId);
    if (back) clearTimeout(back.timer);
    leaving.delete(songVersionId);
    const visit = back?.visit ?? { previous: readSeen()[songVersionId] ?? null, opened: new Date().toISOString() };
    setSeenAt({ song: songVersionId, at: visit.previous });
    const seen = () => markSeen(songVersionId, visit.opened);
    window.addEventListener("pagehide", seen);
    return () => {
      window.removeEventListener("pagehide", seen);
      // Seen once one leaves it for good - not when it's only mounted again.
      leaving.set(songVersionId, { visit, timer: setTimeout(() => (leaving.delete(songVersionId), seen()), 1000) });
    };
  }, [songVersionId]);
  return (note) => {
    if (!seenAt || seenAt.song !== songVersionId || !seenAt.at) return false;
    const last = lastActivity(note);
    return last.by !== me && last.at > seenAt.at;
  };
}
