import type { SyncTimer } from "../screens/timers.js";
import { SCREEN_SWITCHABLE_LAYERS, type ScreenSwitchableLayer } from "../screens/theme.js";
import type { MetronomeSettings } from "../metronome/index.js";
import type { PlaybackSource } from "../playback/index.js";
import type { LiveCommandOp, LiveSessionState } from "../live/index.js";
import type { LiveHandback } from "../live/engine.js";

/**
 * Sync play (issue #13): the messages between a device and the API's
 * WebSocket at `/sync`, and the clock maths. One device leads a set's
 * session; the others follow it. Only the timeline crosses the network -
 * "these settings, beat `anchorPosition` at server time `anchorAt`" - and
 * each device plays it on its own clock, so a follower that drops off
 * keeps time. Kept small and JSON, for a headless device (#62) too.
 */

export const SYNC_PATH = "/sync";

/** What a device id may be: 8 to 64 letters, digits, `-` or `_`. */
export const SYNC_DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * This device's id for sync play (issue #247): one per browser tab, kept
 * across its reloads (sessionStorage), so two tabs are two devices. Never
 * throws: without storage, a new one each time.
 */
export function syncDeviceId(): string {
  const make = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9_-]/g, "");
  try {
    const storage = globalThis.sessionStorage;
    const kept = storage?.getItem("oneverse.syncDevice");
    if (kept && SYNC_DEVICE_ID.test(kept)) return kept;
    const id = make();
    storage?.setItem("oneverse.syncDevice", id);
    return id;
  } catch {
    return make();
  }
}

/** The metronome as the leader plays it; followers keep their own sound and volume. */
export interface SyncMetronome {
  settings: Omit<MetronomeSettings, "sound" | "volume">;
  playing: boolean;
  /** Server time (ms since the epoch) of beat `anchorPosition`. */
  anchorAt: number;
  /** In beats from the start, count-in included (see clicksBetween). */
  anchorPosition: number;
}

/** The leader's stems or recording (issue #100): followers play their own files of the song the same way. */
export interface SyncStems {
  songVersionId: string;
  /** Which of the song's multitracks (issue #123); null or left out, its original stems. */
  multitrackId?: string | null;
  /** What the leader plays of it (issue #366): STEMS leaves the takes recorded into the multitrack out. Left out: all its files. */
  source?: "MASTER" | "STEMS" | "TAKES";
  /** Transposed by this many semitones (issue #129); 0 or left out, as recorded. */
  transpose?: number;
  /** By file, which parts are transposed when not as their part says (issue #135). */
  transposeParts?: Record<string, boolean>;
  /** Played this much slower or faster, in its key (issue #139); 1 or left out, as recorded. `position` is in the recording's time. */
  speed?: number;
  title: string;
  playing: boolean;
  /** Seconds into the recording. */
  position: number;
  /** Server time (ms since the epoch) at which `position` is heard; 0 while paused. */
  anchorAt: number;
}

/**
 * What the leader shows on the set's screens (issue #186): a slide of a song
 * of the set, as setItemSlides() cuts it (a song's lyrics or a text's paragraphs), or nothing (`black`).
 */
export interface SyncPresenting {
  itemId: string;
  slide: number;
  /** The screens go black (between songs, or while someone speaks). */
  black: boolean;
  /**
   * The item's slides as the sender cut them (slideKey(), issue #247): a
   * screen whose own differ loads the item again, and still different, shows
   * no words rather than another slide's. Left out by older clients.
   */
  slideKey?: string;
}

/** A screen as it's told what it is (issue #186). */
export interface SyncScreenInfo {
  id: string;
  name: string;
  mode: "LYRICS" | "CHART";
  /** The set it shows; null until it's given one. */
  setId: string | null;
  /** A Oneverse Pulse (issue #320): it mirrors its set's session and hands it back; left out for a screen. */
  pulse?: boolean;
}

export interface SyncSession {
  /** The session's id (issue #247): the same from the moment it starts until it ends, whoever leads it. Left out by an older server. */
  sessionId?: string;
  /** Goes up each time another authority (Oneverse Pulse, the cloud back) takes the session (issue #247). Left out: 0. */
  epoch?: number;
  /** Goes up with each change. */
  rev: number;
  leader: { id: string; name: string; online: boolean };
  metronome: SyncMetronome | null;
  /** The leader's stems, or null when none are playing or paused. */
  stems?: SyncStems | null;
  /** The set item the leader has open, for followers to follow; null when none. */
  itemId: string | null;
  /** What the set's screens show (issue #186); null or left out when nobody's presenting. */
  presenting?: SyncPresenting | null;
  /**
   * Goes up with each change of what's presented (issue #305), and only
   * then: a command says which it was based on (`basedOn`), and one based on
   * an older one is refused - two people pressing Next together move the
   * screens once. Left out: 0.
   */
  presentingRev?: number;
  /** Who the leader handed presenting to, live (issue #305), besides who may anyway. */
  presenters?: { id: string; name: string }[];
  /**
   * Who runs the screens besides the leader (issue #275): a media operator,
   * sharing them, or alone (exclusive: control is locked to them, issue #305 -
   * everyone else's present commands are refused, and Live says so). Null or
   * left out: whoever may present presents. A lock is the person's, on any of
   * their devices. `online: false`: their connection dropped; the screens wait
   * a minute for their console to take them back, then are the leader's again.
   */
  screens?: { id: string; name: string; exclusive: boolean; online?: boolean } | null;
  /**
   * What plays with the set's songs, as the leader chose it for everyone
   * (issue #366), by item: each device plays that rather than its own
   * choice. Left out or missing an item: each person's own.
   */
  playback?: Record<string, PlaybackSource>;
}

/**
 * What the media operator runs for a set's screens (issue #269): its timer
 * and its message to the stage. Kept beside the session - it needs no
 * leader - and sent with it to everyone in the set, screens included.
 */
export interface SyncStage {
  rev: number;
  timer: SyncTimer | null;
  /** `at`: when it was sent (server time, ms). */
  message: { text: string; at: number } | null;
  /** What the screens draw (issue #275); left out: everything, no overlay. */
  layers?: SyncLayers;
}

/**
 * What the screens draw (issues #280, #287): the layers hidden, the title
 * card over everything or not, and the layers cleared - hidden until the
 * slide or the item on screen changes, as `cleared` notes where they were.
 */
export interface SyncLayerState {
  hidden: ScreenSwitchableLayer[];
  title: boolean;
  cleared: { layers: ScreenSwitchableLayer[]; itemId: string | null; slide: number } | null;
}

/** The screens' layers: for all of them, and for some screens their own (by screen id), set from the operator's view. */
export interface SyncLayers extends SyncLayerState {
  screens?: Record<string, SyncLayerState>;
}

export const DEFAULT_SYNC_LAYERS: SyncLayers = { hidden: [], title: false, cleared: null };

/** The most screens with layers of their own. */
export const SYNC_LAYER_SCREENS_MAX = 32;

const isLayer = (value: unknown): value is ScreenSwitchableLayer => (SCREEN_SWITCHABLE_LAYERS as readonly unknown[]).includes(value);

function readLayerState(input: unknown): SyncLayerState {
  if (!input || typeof input !== "object") return DEFAULT_SYNC_LAYERS;
  const raw = input as Record<string, unknown>;
  // Before layers (issue #275): the words, the background and an overlay.
  if (!("hidden" in raw) && ("words" in raw || "background" in raw || "overlay" in raw)) {
    return { hidden: [...(raw.background === false ? (["media"] as const) : []), ...(raw.words === false ? (["content"] as const) : [])], title: raw.overlay === "title", cleared: null };
  }
  const hidden = Array.isArray(raw.hidden) ? SCREEN_SWITCHABLE_LAYERS.filter((one) => (raw.hidden as unknown[]).includes(one)) : [];
  const cleared = raw.cleared && typeof raw.cleared === "object" ? (raw.cleared as Record<string, unknown>) : null;
  return {
    hidden,
    title: raw.title === true,
    cleared:
      cleared && Array.isArray(cleared.layers)
        ? { layers: SCREEN_SWITCHABLE_LAYERS.filter((one) => (cleared.layers as unknown[]).includes(one)), itemId: typeof cleared.itemId === "string" ? cleared.itemId : null, slide: typeof cleared.slide === "number" ? cleared.slide : 0 }
        : null,
  };
}

/** A stage's layers as a client reads them: anything it can't read left out, the ones kept before layers (issue #275) read as theirs. Never throws. */
export function readSyncLayers(input: unknown): SyncLayers {
  const all = readLayerState(input);
  const screens = input && typeof input === "object" ? (input as Record<string, unknown>).screens : undefined;
  if (!screens || typeof screens !== "object") return all;
  const own = Object.fromEntries(Object.entries(screens as Record<string, unknown>).slice(0, SYNC_LAYER_SCREENS_MAX).map(([id, state]) => [id, readLayerState(state)]));
  return Object.keys(own).length ? { ...all, screens: own } : all;
}

/** What a screen draws: each layer shown or not, and the title card. */
export interface ScreenLayersShown {
  shown: Record<ScreenSwitchableLayer, boolean>;
  title: boolean;
}

/**
 * What a screen draws now (issue #287): its own layers if the operator gave
 * it some, else all screens'; less what the screen itself never shows (its
 * settings win), less what was cleared while the same slide is still on.
 */
export function screenLayers(
  layers: unknown,
  presenting: Pick<SyncPresenting, "itemId" | "slide"> | null | undefined,
  screen?: { id: string; hidden?: readonly string[] } | null,
): ScreenLayersShown {
  const read = readSyncLayers(layers);
  const state = (screen && read.screens?.[screen.id]) || read;
  const cleared = state.cleared && state.cleared.itemId === (presenting?.itemId ?? null) && state.cleared.slide === (presenting?.slide ?? 0) ? state.cleared.layers : [];
  const shown = Object.fromEntries(
    SCREEN_SWITCHABLE_LAYERS.map((layer) => [layer, !state.hidden.includes(layer) && !cleared.includes(layer) && !(screen?.hidden ?? []).includes(layer)]),
  ) as Record<ScreenSwitchableLayer, boolean>;
  return { shown, title: state.title };
}

/**
 * The operator's change to the layers (issues #280, #287), for every screen
 * or, with `screen`, one: layers shown (true) or hidden (false), the title
 * card on or off, layers cleared until the next slide, or all back to normal
 * (`reset`, first). A change for every screen applies to the ones with
 * layers of their own too.
 */
export interface SyncLayersCommand {
  screen?: string | null;
  reset?: boolean;
  show?: Partial<Record<ScreenSwitchableLayer, boolean>>;
  title?: boolean;
  clear?: ScreenSwitchableLayer[];
}

function changeLayerState(state: SyncLayerState, command: SyncLayersCommand, at: { itemId: string | null; slide: number }): SyncLayerState {
  let { hidden, title, cleared } = state;
  // A clear from another slide is over.
  if (cleared && (cleared.itemId !== at.itemId || cleared.slide !== at.slide)) cleared = null;
  for (const [layer, on] of Object.entries(command.show ?? {}) as [ScreenSwitchableLayer, boolean][]) {
    hidden = on ? hidden.filter((one) => one !== layer) : hidden.includes(layer) ? hidden : [...hidden, layer];
    // Shown again: not cleared either.
    if (on && cleared) cleared = { ...cleared, layers: cleared.layers.filter((one) => one !== layer) };
  }
  if (command.title !== undefined) title = command.title;
  if (command.clear?.length) cleared = { ...at, layers: SCREEN_SWITCHABLE_LAYERS.filter((one) => command.clear!.includes(one) || cleared?.layers.includes(one)) };
  if (cleared && cleared.layers.length === 0) cleared = null;
  return { hidden: SCREEN_SWITCHABLE_LAYERS.filter((one) => hidden.includes(one)), title, cleared };
}

/** The layers after the operator's command, at the slide on screen; null when the command can't be read. */
export function applyLayersCommand(layers: unknown, command: SyncLayersCommand, presenting?: Pick<SyncPresenting, "itemId" | "slide"> | null): SyncLayers | null {
  if (!command || typeof command !== "object") return null;
  const { screen, reset, show, title, clear } = command;
  if (screen !== undefined && screen !== null && (typeof screen !== "string" || screen.length === 0 || screen.length > 64)) return null;
  if (reset !== undefined && typeof reset !== "boolean") return null;
  if (title !== undefined && typeof title !== "boolean") return null;
  if (show !== undefined && (!show || typeof show !== "object" || Object.entries(show).some(([layer, on]) => !isLayer(layer) || typeof on !== "boolean"))) return null;
  if (clear !== undefined && (!Array.isArray(clear) || !clear.every(isLayer))) return null;
  const at = { itemId: presenting?.itemId ?? null, slide: presenting?.slide ?? 0 };
  const current = readSyncLayers(layers);
  const { screens = {}, ...all } = current;
  if (screen) {
    if (!screens[screen] && Object.keys(screens).length >= SYNC_LAYER_SCREENS_MAX) return null;
    const own = changeLayerState(reset ? all : (screens[screen] ?? all), command, at);
    // Back to all screens' layers: none of its own.
    const rest = Object.fromEntries(Object.entries(screens).filter(([id]) => id !== screen));
    const next = reset && !show && title === undefined && !clear?.length ? rest : { ...rest, [screen]: own };
    return Object.keys(next).length ? { ...all, screens: next } : all;
  }
  if (reset) return changeLayerState(DEFAULT_SYNC_LAYERS, command, at);
  const next = Object.fromEntries(Object.entries(screens).map(([id, state]) => [id, changeLayerState(state, command, at)]));
  return { ...changeLayerState(all, command, at), ...(Object.keys(next).length ? { screens: next } : {}) };
}

/** The longest message to the stage. */
export const SYNC_STAGE_MESSAGE_MAX = 200;

/** What the operator changes, all optional; see applyStageCommand. */
export interface SyncStageCommand {
  /** A new timer, stopped at its start; null takes it away. */
  timer?: { kind: SyncTimer["kind"]; duration: number } | null;
  /** Back to its start, running or not as it was. */
  reset?: boolean;
  /** Starts (true) or pauses (false) it. */
  run?: boolean;
  /** Seconds more (a countdown's length) or fewer. */
  add?: number;
  /** The message to the stage; null or "" clears it. */
  message?: string | null;
  /** The screens' layers (issues #280, #287): see applyLayersCommand. */
  layers?: SyncLayersCommand;
}

/** Whether a stage command only changes what the screens draw - their layers (issue #322): someone who routes them, without running them, may send it. */
export function stageOnlyLayers(command: SyncStageCommand): boolean {
  return Object.entries(command).every(([key, value]) => key === "layers" || value === undefined || (key === "reset" && value === false));
}

/**
 * A stage after the operator's command (issue #269), at `now` (server time,
 * ms): a new timer, then reset, run or pause, more or less time, then the
 * message, then the layers (at the slide `presenting` has on screen, for
 * a clear). Null when the command can't be read (a duration out of range, a
 * message too long), so the server refuses it.
 */
export function applyStageCommand(stage: SyncStage | null, command: SyncStageCommand, now: number, presenting?: Pick<SyncPresenting, "itemId" | "slide"> | null): SyncStage | null {
  let timer = stage?.timer ?? null;
  let message = stage?.message ?? null;
  if (command.timer !== undefined) {
    if (command.timer === null) timer = null;
    else {
      const { kind, duration } = command.timer;
      if ((kind !== "countdown" && kind !== "count-up") || !Number.isInteger(duration) || duration < 0 || duration > 86_400) return null;
      timer = { kind, duration, startedAt: null, elapsed: 0 };
    }
  }
  if (command.reset && timer) timer = { ...timer, elapsed: 0, startedAt: timer.startedAt === null ? null : now };
  if (command.run !== undefined && timer) {
    if (command.run && timer.startedAt === null) timer = { ...timer, startedAt: now };
    if (!command.run && timer.startedAt !== null) timer = { ...timer, elapsed: timer.elapsed + Math.max(0, now - timer.startedAt), startedAt: null };
  }
  if (command.add !== undefined) {
    if (!Number.isInteger(command.add) || Math.abs(command.add) > 3600) return null;
    // A countdown's length; a count up's time so far.
    if (timer?.kind === "countdown") timer = { ...timer, duration: Math.max(0, Math.min(86_400, timer.duration + command.add)) };
    else if (timer) timer = { ...timer, elapsed: Math.max(0, timer.elapsed + command.add * 1000) };
  }
  if (command.message !== undefined) {
    if (command.message !== null && (typeof command.message !== "string" || command.message.length > SYNC_STAGE_MESSAGE_MAX)) return null;
    const text = command.message?.trim() ?? "";
    message = text ? { text, at: now } : null;
  }
  let layers = readSyncLayers(stage?.layers);
  if (command.layers !== undefined) {
    const next = applyLayersCommand(layers, command.layers, presenting);
    if (!next) return null;
    layers = next;
  }
  return { rev: (stage?.rev ?? 0) + 1, timer, message, layers };
}

export interface SyncMember {
  id: string;
  name: string;
  leading: boolean;
  /** A screen (issue #186), not a person: it only shows what's presented. */
  screen?: boolean;
}

export type SyncClientMessage =
  | { type: "hello"; token: string }
  /** On Oneverse Pulse's own server (issue #247), in place of hello: a pass the cloud signed (live/pass.ts). Answered with `ready`. */
  | { type: "enter"; pass: string }
  /** A screen signs in with its screen token (issue #186), in place of hello; it joins its set by itself. */
  | { type: "screen"; token: string }
  | { type: "ping"; id: number; sent: number }
  /** A screen's report about itself (issue #286, ScreenReport), every half minute; kept for its owner to see. */
  | { type: "report"; report: unknown }
  /**
   * `deviceId`: this device's own id (issue #247, syncDeviceId()): what it
   * leads or runs is held by it, so coming back from a reload or a dropped
   * connection within the lease, it still is. Left out: by connection, as before.
   */
  | { type: "join"; setId: string; deviceId?: string }
  /**
   * A change to the set's session as a command (issue #247, LiveCommand):
   * answered with `ack` or an `error` carrying its id. The same id sent
   * again (a resend after a drop) is applied once.
   */
  | { type: "command"; id: string; epoch?: number; op: LiveCommandOp }
  /**
   * Oneverse Pulse (issue #247, live/engine.ts): from someone who can edit the
   * set, in it - every `session` that follows carries the session as it's
   * kept (`live`), to take over from if the internet goes. `room`: Pulse's
   * own address on the venue's network (http://…), for the set's devices to
   * continue on when the cloud's gone (`pulse` on their sessions).
   */
  | { type: "mirror"; room?: string }
  /**
   * A pass to the set's session on Oneverse Pulse's own page (issue #247,
   * live/pass.ts), for this person on this device, in a set they're in:
   * answered with `pass`. Ask again well before it expires.
   */
  | { type: "pass" }
  /** Pulse back online: the session as the room ran it, and what it did. Answered with `handedBack`, or an error. */
  | { type: "handback"; handback: LiveHandback }
  | { type: "leave" }
  /** Starts a session, or takes over the lead of the one going on. */
  | { type: "lead" }
  /**
   * The media operator (issue #275), anyone who can lead the set: takes the
   * screens, shared with the leader or exclusive; null gives them back. With
   * no session yet, it starts one, led by them.
   */
  | { type: "screens"; control: "shared" | "exclusive" | null }
  /**
   * What the screens show (issue #305), from anyone who may present - the
   * leader, a screens operator (a role), someone the leader handed it to -
   * unless control is locked to someone else. `basedOn`: the presentingRev it
   * was decided from; refused ("stale") when the screens have moved on since.
   */
  | { type: "present"; presenting: SyncPresenting | null; basedOn?: number }
  | { type: "update"; metronome?: SyncMetronome | null; stems?: SyncStems | null; itemId?: string | null; presenting?: SyncPresenting | null; presentingBasedOn?: number; playback?: Record<string, PlaybackSource | null> }
  /** The leader hands presenting to someone in the set, live, or takes it back (issue #305). */
  | { type: "presenter"; userId: string; allow: boolean }
  | { type: "end" }
  /**
   * The media operator (issue #269), anyone who can lead the set: its timer
   * - a new one, stopped; started or paused; back to its start; a minute
   * more or less - and its message to the stage. Applied in that order by
   * applyStageCommand; leading isn't needed.
   */
  | ({ type: "stage" } & SyncStageCommand)
  /**
   * The songs whose notes this device shows (issue #27): told when they
   * change, each opened in a set or not. Replaces what it watched; [] stops.
   */
  | { type: "watch"; songs: { songVersionId: string; setlistId?: string }[] }
  /**
   * What this device is doing in a song it watches (issue #27): editing it,
   * or replying to one of its notes; null song: nothing. Its watchers see it.
   */
  | { type: "presence"; songVersionId: string | null; doing?: SongActivity; noteId?: string }
  /**
   * Live co-editing (issue #27): a song's shared document - Yjs updates,
   * base64 - for who can change its content, where Admin turned it on.
   * Joined with the revision the device loaded; `doc-saved` after saving it.
   */
  | { type: "doc-join"; songVersionId: string; revision: number }
  | { type: "doc-leave"; songVersionId: string }
  /** `seed`: the document's start, by the device `doc-state` picked. */
  | { type: "doc-update"; songVersionId: string; update: string; seed?: boolean }
  | { type: "doc-awareness"; songVersionId: string; update: string }
  | { type: "doc-saved"; songVersionId: string; revision: number }
  /** Drops the changes nobody saved, for everyone in the song: each loads it again. */
  | { type: "doc-discard"; songVersionId: string };

/** The most a shared document's update may weigh (base64). */
export const SYNC_DOC_UPDATE_MAX = 512 * 1024;

/** What someone is doing in a song, for the others in it. */
export type SongActivity = "editing" | "replying";

/** Someone in a song (issue #27): who, doing what - replying to which note. */
export interface SongPresence {
  userId: string;
  name: string;
  /** Their picture, as their account has it. */
  avatarUrl?: string | null;
  doing: SongActivity;
  noteId?: string;
}

/** How many songs one connection may watch at once. */
export const SYNC_WATCH_MAX = 30;

export type SyncServerMessage =
  /** Signed in; `coEditing`: live co-editing is on (issue #27). */
  | { type: "ready"; userId: string; coEditing?: boolean }
  /** To a screen: what it is, again whenever that changes (renamed, another mode or set). Then it's gone: disconnected. */
  | { type: "screen"; screen: SyncScreenInfo }
  /** To a screen (issue #284): show a pairing code again, for another profile beside its own. */
  | { type: "pair-again" }
  | { type: "pong"; id: number; sent: number; at: number }
  | {
      type: "session";
      setId: string;
      session: SyncSession | null;
      members: SyncMember[];
      /** This device leads it. */
      leading: boolean;
      /** This user may lead (they can edit the set). */
      canLead: boolean;
      /** The set's timer and message for its screens (issue #269); left out by an older server. */
      stage?: SyncStage | null;
      /** This device runs the screens (issue #275): it's session.screens. */
      screensMine?: boolean;
      /** This user may present now (issue #305): leads, operates screens, or was handed it - and control isn't locked to someone else. */
      canPresent?: boolean;
      /** This user may cue now (issue #322): move the screens to the next or previous song or section, by `cue` commands. */
      canCue?: boolean;
      /** This user may route the screens now (issue #322): their layers and overlays, by `stage` messages that only carry `layers`. */
      canRoute?: boolean;
      /** This user runs screens (issue #305): can edit the set, or has a role that runs screens - the operator's console is theirs, locked or not. */
      canOperate?: boolean;
      /** The session as it's kept, holders' devices and all: only to a device that asked to `mirror` it (Pulse). */
      live?: LiveSessionState | null;
      /** A Pulse in the set (issue #247): its address on the venue's network, to continue on with a pass if the cloud goes (live/pulse-door.ts). */
      pulse?: string | null;
    }
  /** A pass to the set on Pulse (issue #247): `key` is the cloud's public key, which Pulse checks passes with offline. */
  | { type: "pass"; setId: string; pass: string; key: string; expiresAt: number }
  /** The room's session taken back (issue #247): the cloud runs it again, from `epoch` at `rev`; `rev` 0: it ended. */
  | { type: "handedBack"; sessionId: string; epoch: number; rev: number }
  /** The songs it now watches: those it may see (issue #27). */
  | { type: "watching"; songVersionIds: string[] }
  /** Who's doing something in a watched song now (issue #27), oneself included: whenever it changes. */
  | { type: "presence"; songVersionId: string; people: SongPresence[] }
  /** A watched song was saved (issue #27): by whom, now at `revision`. */
  | { type: "song"; songVersionId: string; revision: number; byId: string | null; by: string | null }
  /**
   * A song's shared document, on joining (issue #27): its state, or none
   * yet - `seed`: this device starts it from the song it loaded; else it
   * waits for the device that does. `revision`: the song's, as the room has it.
   */
  | { type: "doc-state"; songVersionId: string; state: string | null; seed: boolean; revision: number }
  | { type: "doc-update"; songVersionId: string; update: string }
  | { type: "doc-awareness"; songVersionId: string; update: string }
  /** The song changed outside the room (a restore, an accepted suggestion, an import): load it again and join again. */
  | { type: "doc-reset"; songVersionId: string }
  /** Not joined: co-editing is off, or one can't change this song. */
  | { type: "doc-refused"; songVersionId: string; reason: "off" | "forbidden" }
  /** One's notifications changed (one came, or was read elsewhere): the bell reads its count again (issue #27). */
  | { type: "notifications" }
  /** A watched song's notes changed (added, edited, resolved, deleted, replied to): read them again - with one's own rights, the signal carries nothing. */
  | { type: "notes"; songVersionId: string }
  /** `stale` (issue #305): a present command based on what the screens no longer show; the session that follows has what they show now. */
  /** A command (issue #247) applied: the session's revision after it. Sent again, not applied twice, for a command sent again. */
  | { type: "ack"; id: string; rev: number }
  /** `id`: the command refused, when it was one; `epoch`: sent from another epoch of the session (load it again). */
  | { type: "error"; id?: string; code: "unauthorized" | "not-found" | "forbidden" | "bad-request" | "disconnected" | "stale" | "epoch"; message: string };

/**
 * The screens this device runs, after a session message: kept while they're
 * its own; taken back when its connection dropped and they still wait for
 * this person (`online: false`); forgotten once someone else has them, or
 * nobody does.
 */
export function resumeScreens(
  message: { session: SyncSession | null; screensMine?: boolean },
  userId: string | null,
  held: "shared" | "exclusive" | null,
  take: (control: "shared" | "exclusive") => void,
): "shared" | "exclusive" | null {
  const screens = message.session?.screens;
  if (message.screensMine && screens) return screens.exclusive ? "exclusive" : "shared";
  if (!held || !screens || screens.id !== userId) return null;
  if (screens.online === false) take(held);
  return held;
}

/** One ping's round trip: sent and received on the device's clock, `at` on the server's (all ms). */
export interface ClockSample {
  sent: number;
  at: number;
  received: number;
}

/**
 * The server's clock less the device's, from the round trip that took the
 * least time (the one least delayed on the way, so the most exact): the
 * server read its clock halfway through it.
 */
export function clockOffset(samples: ClockSample[]): { offset: number; rtt: number } | null {
  let best: ClockSample | null = null;
  for (const sample of samples) {
    if (sample.received < sample.sent) continue;
    if (!best || sample.received - sample.sent < best.received - best.sent) best = sample;
  }
  if (!best) return null;
  return { offset: best.at - (best.sent + best.received) / 2, rtt: best.received - best.sent };
}

/** The settings a leader shares: all but their own sound and volume. */
export function sharedMetronomeSettings(settings: MetronomeSettings): SyncMetronome["settings"] {
  return {
    tempo: settings.tempo,
    numerator: settings.numerator,
    denominator: settings.denominator,
    beats: settings.beats,
    subdivision: settings.subdivision,
    countIn: settings.countIn,
    countInOnly: settings.countInOnly,
  };
}

/**
 * A time on the server's clock (ms) as this device's clock reads it,
 * `offset` being the server's clock less the device's (clockOffset).
 */
export function deviceTime(serverTime: number, offset: number): number {
  return serverTime - offset;
}

/**
 * Where the leader's metronome is at `serverTime` (ms), in beats from its
 * start (count-in included): it goes on from its anchor at the tempo while
 * playing, and stays there while stopped.
 */
export function metronomePositionAt(metronome: Pick<SyncMetronome, "settings" | "playing" | "anchorAt" | "anchorPosition">, serverTime: number): number {
  if (!metronome.playing) return metronome.anchorPosition;
  return metronome.anchorPosition + ((serverTime - metronome.anchorAt) / 1000) * (metronome.settings.tempo / 60);
}

/**
 * Seconds into the leader's recording at `serverTime` (ms): it goes on
 * from its anchor at its speed (issue #139) while playing, in the
 * recording's own time, and stays there while paused.
 */
export function stemsPositionAt(stems: Pick<SyncStems, "playing" | "position" | "anchorAt" | "speed">, serverTime: number): number {
  if (!stems.playing) return stems.position;
  return stems.position + ((serverTime - stems.anchorAt) / 1000) * (stems.speed ?? 1);
}
