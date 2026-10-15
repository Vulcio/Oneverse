import { deviceOffline, SYNC_PATH, type SongActivity, type SongPresence, type SyncClientMessage, type SyncServerMessage } from "@songverse/core";
import { getApiUrl } from "@songverse/app/public-env";
import { useEffect, useState } from "react";
import { apiToken } from "#/lib/api-client";

/**
 * Live songs (issue #27): one connection per tab to the API's /sync while a
 * page shows songs, watching them. It hears when a song's notes change, when
 * the song is saved, and who's doing what in it (editing it, replying to a
 * note) - and says what this tab is doing. The signals carry nothing a
 * watcher couldn't read: a page reads the notes or the song again with its
 * own rights. On reconnecting, notes are read again: changes made while the
 * connection was down weren't heard.
 */

export interface SongSaved {
  revision: number;
  byId: string | null;
  by: string | null;
}

interface Watch {
  songVersionId: string;
  setlistId?: string;
  onNotes?: () => void;
  onSaved?: (saved: SongSaved) => void;
  onPresence?: (people: SongPresence[]) => void;
}

const watches = new Set<Watch>();
let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let closing: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
let signedIn = false;
/** What this tab is doing, sent whenever the connection is (re)made. */
let myPresence: { songVersionId: string; doing: SongActivity; noteId?: string } | null = null;
/** Who's in each watched song, as last heard: a page that starts watching sees them at once. */
const presence = new Map<string, SongPresence[]>();
/** Notes changes heard, run together a moment later: a burst of writes reads the notes once. */
const due = new Set<string>();
let dueTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 250;

function send(message: SyncClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** What's watched now, sent whole (it replaces the last), then what this tab is doing in it. */
function sendWatches() {
  if (!signedIn) return;
  const songs = new Map<string, { songVersionId: string; setlistId?: string }>();
  for (const watch of watches) songs.set(`${watch.songVersionId}|${watch.setlistId ?? ""}`, { songVersionId: watch.songVersionId, ...(watch.setlistId && { setlistId: watch.setlistId }) });
  send({ type: "watch", songs: [...songs.values()] });
  sendPresence();
}

function sendPresence() {
  if (!signedIn) return;
  const watched = myPresence && [...watches].some((watch) => watch.songVersionId === myPresence!.songVersionId);
  send(watched ? { type: "presence", ...myPresence! } : { type: "presence", songVersionId: null });
}

function notesChanged(songVersionId: string | null) {
  if (songVersionId) due.add(songVersionId);
  else for (const watch of watches) due.add(watch.songVersionId);
  if (dueTimer) return;
  dueTimer = setTimeout(() => {
    dueTimer = null;
    const songs = new Set(due);
    due.clear();
    for (const watch of [...watches]) if (songs.has(watch.songVersionId)) watch.onNotes?.();
  }, DEBOUNCE_MS);
}

function receive(message: SyncServerMessage) {
  if (message.type === "ready") {
    signedIn = true;
    sendWatches();
    // Back after a drop: what changed meanwhile wasn't heard.
    if (retries > 0) notesChanged(null);
    retries = 0;
  } else if (message.type === "notes") notesChanged(message.songVersionId);
  else if (message.type === "song") {
    const saved = { revision: message.revision, byId: message.byId, by: message.by };
    for (const watch of [...watches]) if (watch.songVersionId === message.songVersionId) watch.onSaved?.(saved);
  } else if (message.type === "presence") {
    presence.set(message.songVersionId, message.people);
    for (const watch of [...watches]) if (watch.songVersionId === message.songVersionId) watch.onPresence?.(message.people);
  }
}

function connect() {
  if (typeof window === "undefined" || socket || watches.size === 0 || deviceOffline()) return;
  const ws = new WebSocket(`${getApiUrl().replace(/^http/, "ws").replace(/\/$/, "")}${SYNC_PATH}`);
  socket = ws;
  signedIn = false;
  ws.onopen = () => {
    void apiToken().then((token) => {
      if (socket === ws && token) send({ type: "hello", token });
    });
  };
  ws.onmessage = (event) => {
    if (socket !== ws) return;
    try {
      receive(JSON.parse(String(event.data)) as SyncServerMessage);
    } catch {
      // Not ours to read.
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    signedIn = false;
    presence.clear();
    for (const watch of [...watches]) watch.onPresence?.([]);
    if (watches.size === 0) return;
    // Again, a little later each time (at most every 30 s); at once when the network is back.
    retries++;
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, Math.min(30_000, 1000 * 2 ** Math.min(retries, 5)));
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (retry) clearTimeout(retry);
    retry = null;
    connect();
  });
}

/** Hears about a song - its notes changing, its saves, who's in it - until the returned function is called. */
export function watchSong(song: { songVersionId: string; setlistId?: string | null }, handlers: Omit<Watch, "songVersionId" | "setlistId">): () => void {
  const watch: Watch = { songVersionId: song.songVersionId, ...(song.setlistId && { setlistId: song.setlistId }), ...handlers };
  watches.add(watch);
  const known = presence.get(song.songVersionId);
  if (known) watch.onPresence?.(known);
  if (closing) clearTimeout(closing);
  closing = null;
  if (socket) sendWatches();
  else connect();
  return () => {
    watches.delete(watch);
    sendWatches();
    // Nothing left to watch: closed a moment later (the next page usually watches again at once).
    if (watches.size === 0 && !closing) {
      closing = setTimeout(() => {
        closing = null;
        if (watches.size > 0) return;
        if (retry) clearTimeout(retry);
        retry = null;
        const ws = socket;
        socket = null;
        ws?.close();
      }, 5000);
    }
  };
}

/** Calls `onChange` whenever the song's notes change, until the returned function is called. */
export function watchSongNotes(song: { songVersionId: string; setlistId?: string | null }, onChange: () => void): () => void {
  return watchSong(song, { onNotes: onChange });
}

/** What this tab is doing in a song it watches (editing it, replying to a note), or nothing. */
export function setPresence(next: { songVersionId: string; doing: SongActivity; noteId?: string } | null): void {
  myPresence = next;
  sendPresence();
}

/** Who else is doing something in a song now (oneself left out), as it changes. */
export function useSongPresence(songVersionId: string | null | undefined, myId: string): SongPresence[] {
  const [people, setPeople] = useState<SongPresence[]>([]);
  useEffect(() => {
    if (!songVersionId) return setPeople([]);
    return watchSong({ songVersionId }, { onPresence: setPeople });
  }, [songVersionId]);
  return people.filter((person) => person.userId !== myId);
}

/** While mounted (and `active`), this tab is doing `doing` in the song. */
export function usePresence(songVersionId: string | null | undefined, doing: SongActivity, active = true, noteId?: string) {
  useEffect(() => {
    if (!songVersionId || !active) return;
    const mine = { songVersionId, doing, ...(noteId && { noteId }) };
    const before = myPresence;
    // Only in a song it watches.
    const unwatch = watchSong({ songVersionId }, {});
    setPresence(mine);
    return () => {
      // Back to what it was doing before (replying ends: editing again).
      if (myPresence === mine) setPresence(before);
      unwatch();
    };
  }, [songVersionId, doing, active, noteId]);
}
