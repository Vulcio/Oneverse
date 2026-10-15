import { type SectionInstance, type SectionV2 } from "@songverse/core";
import type { Schema } from "@tiptap/pm/model";
import { defaultDeleteFilter, defaultProtectedNodes, prosemirrorJSONToYXmlFragment, ySyncPluginKey } from "@tiptap/y-tiptap";
import { useEffect, useRef, useState } from "react";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import { coEditingOn, openDocChannel, sendDoc, type DocMessage } from "#/lib/live-notes";
import { songToEditorJSON } from "./document";

/**
 * Typing in a song together (issue #27): the chart as a Yjs document shared
 * through the API's /sync, where Admin turned live co-editing on. The chart
 * is the editor's blocks (`chart`), its key and each pass's details (label,
 * key change, a linked copy's changes) are maps beside it, so the key a
 * transposition moves and the details of the song order travel too. The
 * song is still saved by the devices, as it always was.
 */

/** Changes heard from the room, applied without being sent back. */
const REMOTE = Symbol("remote");
/** The document's start, from the song as saved. */
const SEED = Symbol("seed");
/** This device's own changes to the maps, undone with its typing. */
export const SHARED_LOCAL = Symbol("local");
/** Updates and carets go out at most this often: a word typed is one message, not a message a letter. */
const SEND_MS = 80;
/** No document yet and nobody starting it: joining again after this. */
const WAIT_MS = 5000;
/** Not in the room by then (no connection, say): the editor works alone. */
const GIVE_UP_MS = 8000;

export interface SharedSong {
  songVersionId: string;
  doc: Y.Doc;
  fragment: Y.XmlFragment;
  /** The song's key, and which room it is (one started from the song, kept until the room starts over). */
  song: Y.Map<unknown>;
  /** Each pass's details, by its ID (the order itself is the chart's blocks). */
  passes: Y.Map<unknown>;
  awareness: Awareness;
  /** For the carets (CollaborationCaret reads `provider.awareness`). */
  provider: { awareness: Awareness };
  /** Undoes this device's own changes only - the chart, the key and the passes' details. */
  undoManager: Y.UndoManager;
}

/** The song as saved, to start the document from, and its revision to join with. */
export interface SavedSong {
  revision: number;
  sections: SectionV2[];
  flow: SectionInstance[];
  key: string;
}

export type SharedState = { status: "off" } | { status: "joining" } | { status: "ready"; room: SharedSong; generation: number };

/** A pass's details as kept in the room: everything but which pass and section it is. */
export function passDetails(pass: SectionInstance): Record<string, unknown> {
  const details: Record<string, unknown> = JSON.parse(JSON.stringify(pass));
  delete details.id;
  delete details.sectionId;
  return details;
}

function newRoom(songVersionId: string): SharedSong {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("chart");
  const song = doc.getMap<unknown>("song");
  const passes = doc.getMap<unknown>("passes");
  const awareness = new Awareness(doc);
  const undoManager = new Y.UndoManager([fragment, song, passes], {
    trackedOrigins: new Set<unknown>([ySyncPluginKey, SHARED_LOCAL]),
    deleteFilter: (item) => defaultDeleteFilter(item, defaultProtectedNodes),
    captureTransaction: (transaction) => transaction.meta.get("addToHistory") !== false,
  });
  return { songVersionId, doc, fragment, song, passes, awareness, provider: { awareness }, undoManager };
}

function fill(room: SharedSong, schema: Schema, saved: SavedSong) {
  room.doc.transact(() => {
    prosemirrorJSONToYXmlFragment(schema, songToEditorJSON(saved.sections, saved.flow), room.fragment);
    room.song.set("key", saved.key || null);
    room.song.set("room", crypto.randomUUID());
    for (const pass of saved.flow) room.passes.set(pass.id, passDetails(pass));
  }, SEED);
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/**
 * The song's shared document while the editor is open: "off" when co-editing
 * is off or the room refused (the editor works alone, as before), "ready"
 * with the room to bind once it has the document. `onNewer`: the room is at a
 * revision newer than the page's (load it, for saving). `onReset`: the song
 * changed outside the room (a restore, someone discarding): what nobody
 * saved is dropped, load the song; the room starts again by itself.
 */
export function useSharedSong({
  songVersionId,
  enabled,
  schema,
  me,
  loadSaved,
  onNewer,
  onReset,
}: {
  songVersionId: string | null;
  enabled: boolean;
  schema: Schema;
  /** Who this is, on their caret. */
  me: { name: string; color: string };
  loadSaved: () => Promise<SavedSong>;
  onNewer: (revision: number) => void;
  onReset: () => void;
}): SharedState {
  const [state, setState] = useState<SharedState>(enabled && songVersionId ? { status: "joining" } : { status: "off" });
  const [generation, setGeneration] = useState(0);
  const handlers = useRef({ loadSaved, onNewer, onReset, me });
  handlers.current = { loadSaved, onNewer, onReset, me };

  useEffect(() => {
    if (!enabled || !songVersionId) return setState({ status: "off" });
    if (coEditingOn() === false) return setState({ status: "off" });
    setState({ status: "joining" });
    const id = songVersionId;
    const room = newRoom(id);
    room.awareness.setLocalStateField("user", handlers.current.me);
    let ready = false;
    /** Joining again after the connection dropped, with a document already. */
    let rejoining = false;
    let gone = false;
    let saved: SavedSong | null = null;
    let joinedRevision = 0;
    let waiting: ReturnType<typeof setTimeout> | null = null;
    let pending: Uint8Array[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let caretTimer: ReturnType<typeof setTimeout> | null = null;
    const giveUp = setTimeout(() => {
      if (ready || gone) return;
      gone = true;
      sendDoc({ type: "doc-leave", songVersionId: id });
      setState({ status: "off" });
    }, GIVE_UP_MS);

    const markReady = () => {
      if (waiting) clearTimeout(waiting);
      waiting = null;
      if (ready) return;
      clearTimeout(giveUp);
      ready = true;
      setState({ status: "ready", room, generation });
      sendCaret();
      flush();
    };
    const flush = () => {
      flushTimer = null;
      if (!ready || pending.length === 0) return;
      const update = pending.length === 1 ? pending[0]! : Y.mergeUpdates(pending);
      pending = [];
      // Not sent (the connection is down): joining again sends what the room is missing.
      sendDoc({ type: "doc-update", songVersionId: id, update: toBase64(update) });
    };
    const sendCaret = () => {
      caretTimer = null;
      if (ready) sendDoc({ type: "doc-awareness", songVersionId: id, update: toBase64(encodeAwarenessUpdate(room.awareness, [room.doc.clientID])) });
    };
    room.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || origin === SEED) return;
      pending.push(update);
      flushTimer ??= setTimeout(flush, SEND_MS);
    });
    room.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === REMOTE || ![...added, ...updated, ...removed].includes(room.doc.clientID)) return;
      caretTimer ??= setTimeout(sendCaret, SEND_MS);
    });

    /** Starts over: a new document from the song as saved (the editor is made again with it). */
    const startOver = () => {
      if (gone) return;
      gone = true;
      handlers.current.onReset();
      setState({ status: "joining" });
      setGeneration((n) => n + 1);
    };

    const join = async () => {
      if (gone) return;
      if (coEditingOn() === false) return setState({ status: "off" });
      try {
        saved = await handlers.current.loadSaved();
      } catch {
        return setState({ status: "off" });
      }
      if (gone) return;
      joinedRevision = saved.revision;
      rejoining = ready;
      sendDoc({ type: "doc-join", songVersionId: id, revision: saved.revision });
    };

    const receive = (message: DocMessage) => {
      if (gone) return;
      switch (message.type) {
        case "doc-connected":
          void join();
          return;
        case "doc-state": {
          if (message.state) {
            const state = fromBase64(message.state);
            if (rejoining) {
              // Back after a drop: the same room takes what this device typed meanwhile; another one (it started over) means starting over here too.
              const theirs = new Y.Doc();
              Y.applyUpdate(theirs, state);
              const same = theirs.getMap("song").get("room") === room.song.get("room");
              theirs.destroy();
              if (!same) return startOver();
            }
            Y.applyUpdate(room.doc, state, REMOTE);
            if (rejoining) sendDoc({ type: "doc-update", songVersionId: id, update: toBase64(Y.encodeStateAsUpdate(room.doc, Y.encodeStateVectorFromUpdate(state))) });
            markReady();
          } else if (message.seed) {
            // Picked to start it: from the song as saved - or, back after a drop with the room gone, from what this device has.
            if (!rejoining && saved) fill(room, schema, saved);
            sendDoc({ type: "doc-update", songVersionId: id, update: toBase64(Y.encodeStateAsUpdate(room.doc)), seed: true });
            markReady();
          } else if (rejoining) {
            // The room is gone and someone else starts it again: theirs and this one can't be merged.
            return startOver();
          } else if (!ready) {
            waiting = setTimeout(() => void join(), WAIT_MS);
          }
          if (message.revision > joinedRevision) handlers.current.onNewer(message.revision);
          return;
        }
        case "doc-update":
          Y.applyUpdate(room.doc, fromBase64(message.update), REMOTE);
          // The start, from whoever was picked to make it.
          if (room.fragment.length > 0) markReady();
          return;
        case "doc-awareness":
          applyAwarenessUpdate(room.awareness, fromBase64(message.update), REMOTE);
          return;
        case "doc-reset":
          return startOver();
        case "doc-refused":
          gone = true;
          setState({ status: "off" });
          return;
      }
    };
    const close = openDocChannel(id, receive);
    return () => {
      gone = true;
      const wasReady = ready;
      ready = false;
      if (waiting) clearTimeout(waiting);
      clearTimeout(giveUp);
      if (flushTimer) clearTimeout(flushTimer);
      // What was typed in the last moment still goes.
      if (wasReady && pending.length > 0) sendDoc({ type: "doc-update", songVersionId: id, update: toBase64(Y.mergeUpdates(pending)) });
      if (caretTimer) clearTimeout(caretTimer);
      // Its caret goes from the others' screens (the server also says so when the connection goes).
      removeAwarenessStates(room.awareness, [room.doc.clientID], "local");
      if (wasReady) sendDoc({ type: "doc-awareness", songVersionId: id, update: toBase64(encodeAwarenessUpdate(room.awareness, [room.doc.clientID])) });
      sendDoc({ type: "doc-leave", songVersionId: id });
      close();
      room.undoManager.destroy();
      room.awareness.destroy();
      room.doc.destroy();
    };
  }, [songVersionId, enabled, generation]);

  return state;
}
