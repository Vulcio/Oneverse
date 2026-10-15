import { deviceOffline, SYNC_PATH, type SyncClientMessage, type SyncServerMessage } from "@songverse/core";
import { getApiUrl } from "@songverse/app/public-env";
import { apiToken } from "#/lib/api-client";

/**
 * Live notes (issue #27): one connection per tab to the API's /sync while a
 * page shows notes, watching those songs. When a song's notes change -
 * someone adds one, replies, edits, resolves or deletes - its watchers are
 * called and read the notes again with their own rights (the signal carries
 * nothing). On reconnecting, every watcher reads them again: changes made
 * while the connection was down weren't heard.
 */

interface Watch {
  songVersionId: string;
  setlistId?: string;
  onChange: () => void;
}

const watches = new Set<Watch>();
let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let closing: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
let signedIn = false;
/** Changes heard, run together a moment later: a burst of writes reads the notes once. */
const due = new Set<string>();
let dueTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 250;

function send(message: SyncClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** What's watched now, sent whole (it replaces the last). */
function sendWatches() {
  if (!signedIn) return;
  const songs = new Map<string, { songVersionId: string; setlistId?: string }>();
  for (const watch of watches) songs.set(`${watch.songVersionId}|${watch.setlistId ?? ""}`, { songVersionId: watch.songVersionId, ...(watch.setlistId && { setlistId: watch.setlistId }) });
  send({ type: "watch", songs: [...songs.values()] });
}

function changed(songVersionId: string | null) {
  if (songVersionId) due.add(songVersionId);
  else for (const watch of watches) due.add(watch.songVersionId);
  if (dueTimer) return;
  dueTimer = setTimeout(() => {
    dueTimer = null;
    const songs = new Set(due);
    due.clear();
    for (const watch of [...watches]) if (songs.has(watch.songVersionId)) watch.onChange();
  }, DEBOUNCE_MS);
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
    let message: SyncServerMessage;
    try {
      message = JSON.parse(String(event.data)) as SyncServerMessage;
    } catch {
      return;
    }
    if (message.type === "ready") {
      signedIn = true;
      sendWatches();
      // Back after a drop: what changed meanwhile wasn't heard.
      if (retries > 0) changed(null);
      retries = 0;
    } else if (message.type === "notes") changed(message.songVersionId);
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    signedIn = false;
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

/** Calls `onChange` whenever the song's notes change, until the returned function is called. */
export function watchSongNotes(song: { songVersionId: string; setlistId?: string | null }, onChange: () => void): () => void {
  const watch: Watch = { songVersionId: song.songVersionId, ...(song.setlistId && { setlistId: song.setlistId }), onChange };
  watches.add(watch);
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
