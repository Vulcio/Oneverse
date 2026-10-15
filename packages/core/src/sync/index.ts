import type { SyncTimer } from "../screens/timers.js";
import type { MetronomeSettings } from "../metronome/index.js";

/**
 * Sync play (issue #13): the messages between a device and the API's
 * WebSocket at `/sync`, and the clock maths. One device leads a set's
 * session; the others follow it. Only the timeline crosses the network -
 * "these settings, beat `anchorPosition` at server time `anchorAt`" - and
 * each device plays it on its own clock, so a follower that drops off
 * keeps time. Kept small and JSON, for a headless device (#62) too.
 */

export const SYNC_PATH = "/sync";

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
 * of the set, as lyricSlides() cuts it, or nothing (`black`).
 */
export interface SyncPresenting {
  itemId: string;
  slide: number;
  /** The screens go black (between songs, or while someone speaks). */
  black: boolean;
}

/** A screen as it's told what it is (issue #186). */
export interface SyncScreenInfo {
  id: string;
  name: string;
  mode: "LYRICS" | "CHART";
  /** The set it shows; null until it's given one. */
  setId: string | null;
}

export interface SyncSession {
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
}

/**
 * A stage after the operator's command (issue #269), at `now` (server time,
 * ms): a new timer, then reset, run or pause, more or less time, then the
 * message. Null when the command can't be read (a duration out of range, a
 * message too long), so the server refuses it.
 */
export function applyStageCommand(stage: SyncStage | null, command: SyncStageCommand, now: number): SyncStage | null {
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
  return { rev: (stage?.rev ?? 0) + 1, timer, message };
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
  /** A screen signs in with its screen token (issue #186), in place of hello; it joins its set by itself. */
  | { type: "screen"; token: string }
  | { type: "ping"; id: number; sent: number }
  | { type: "join"; setId: string }
  | { type: "leave" }
  /** Starts a session, or takes over the lead of the one going on. */
  | { type: "lead" }
  | { type: "update"; metronome?: SyncMetronome | null; stems?: SyncStems | null; itemId?: string | null; presenting?: SyncPresenting | null }
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
    }
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
  | { type: "error"; code: "unauthorized" | "not-found" | "forbidden" | "bad-request" | "disconnected"; message: string };

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
