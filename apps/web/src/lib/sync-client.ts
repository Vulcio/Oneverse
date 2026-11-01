import {
  clockOffset,
  filesForSource,
  LiveCommands,
  PulseDoor,
  resumeScreens,
  samePresenting,
  stageOnlyLayers,
  SYNC_PATH,
  sharedMetronomeSettings,
  syncDeviceId,
  type ClockSample,
  type SyncClientMessage,
  type SyncMember,
  type SyncServerMessage,
  type SyncPresenting,
  type SyncSession,
  type SyncStage,
  type SyncStageCommand,
  type SyncStems,
  type PlaybackSource,
} from "@oneverse/core";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { apiToken, forgetApiToken } from "#/lib/api-client";
import {
  deviceNow,
  followMetronome,
  getMetronomeState,
  unlockMetronomeAudio,
  realignMetronome,
  setMetronomeStartDelay,
  takeOverMetronome,
  unfollowMetronome,
  useMetronome,
  type FollowedTimeline,
  type MetronomeState,
} from "#/lib/metronome-engine";
import { getApiUrl } from "@oneverse/app/public-env";
import { fileLoader, songFiles } from "#/lib/song-files";
import { followStems, getStemState, playableOf, realignStems, setStemsDirectOutput, setStemsSpeed, setStemsTranspose, unfollowStems, unlockStemsAudio, useStems, type StemSong, type StemState } from "#/lib/stem-engine";

/**
 * Sync play in the browser (issue #13): one connection per tab to the API's
 * /sync, on while the player has it on for a set - across pages, and after
 * a reload (sessionStorage) - reconnecting when it drops.
 *
 * Leading, the metronome's timeline goes out each time it changes (as
 * "beat N at server time T"); following, it comes in and the metronome
 * plays it on this device's own clock. The clocks' offset comes from pings,
 * the quickest of the last few; the audio clock is placed against the
 * device's through the output timestamp (metronome-engine), so a click is
 * placed by when it's heard.
 */

const STORAGE_KEY = "songverse.sync";
/** A start while leading waits this long, for the followers to hear the first beat too. */
const LEADER_START_DELAY = 0.5;
/**
 * Pings: a few quick ones on connecting, then one a second for a while
 * (the page is often busy starting up at first, which slows the first
 * ones), then one every so often; the quickest of the last ones counts.
 */
const FIRST_PINGS = 8;
const EARLY_PING_MS = 1000;
const EARLY_PINGS_FOR_MS = 20_000;
const PING_EVERY_MS = 5000;
const SAMPLES_KEPT = 12;
/** The leader re-sends where the beat is, and a follower re-places it, this often: the audio and device clocks drift apart slowly. */
const RESYNC_MS = 10_000;

export interface SyncState {
  /** The set sync is on for, or null when it's off. */
  setId: string | null;
  status: "off" | "connecting" | "on";
  session: SyncSession | null;
  members: SyncMember[];
  leading: boolean;
  canLead: boolean;
  error: string | null;
  /** The server's clock less this device's (ms), once measured. */
  offset: number | null;
  /** The set's timer and message for its screens (issue #269). */
  stage: SyncStage | null;
  /** This device runs the screens (issue #275). */
  screensMine: boolean;
  /** This user may present now (issue #305): leads, runs screens, or was handed it - and control isn't locked to someone else. */
  canPresent: boolean;
  /** This user may cue now (issue #322): move the screens to the next or previous song or section; left out by an older server. */
  canCue?: boolean;
  /** This user may route the screens now (issue #322): their layers and overlays; left out by an older server. */
  canRoute?: boolean;
  /** This user runs screens (issue #305): can edit the set, or has a role that runs screens. */
  canOperate: boolean;
  /** A change this device made is on its way, not yet confirmed by the server (issue #247). */
  sending?: boolean;
  /** The set's Pulse's page with this person's pass (issue #247, core's PulseDoor): "Continue on Pulse" while the cloud's gone. */
  pulseLink?: string | null;
}

let state: SyncState = { setId: null, status: "off", session: null, members: [], leading: false, canLead: false, error: null, offset: null, stage: null, screensMine: false, canPresent: false, canOperate: false };
/** Plays what the leader plays (the metronome, the stems); an operator's page (issue #269) only watches. */
let following = true;
const listeners = new Set<() => void>();
/**
 * Slides sent as commands (issue #247): each kept until the server answers it,
 * sent again once back in the set after a connection that died without anyone
 * knowing (a phone on a weak signal), and shown meanwhile rather than the
 * session from before it - so a slide changed doesn't jump back.
 */
const commands = new LiveCommands((message) => {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
});
let rejoining = false;
/** The set's Pulse, and a pass to it, for when the cloud's gone (issue #247). */
const door = new PulseDoor(() => send({ type: "pass" }));
/** The session as the server last sent it; `state.session` shows over it the slides this device sent that are on their way. */
let serverSession: SyncSession | null = null;
function emit(next: Partial<SyncState>) {
  if (next.session !== undefined) serverSession = next.session;
  state = { ...state, ...next, session: commands.view(serverSession), sending: commands.sending, pulseLink: door.link };
  for (const listener of listeners) listener();
}

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let resyncTimer: ReturnType<typeof setInterval> | null = null;
let samples: ClockSample[] = [];
let pingId = 0;
let userId: string | null = null;
/** The screens this device runs (issue #275), to take back after a dropped connection: see resumeScreens. */
let heldScreens: "shared" | "exclusive" | null = null;
/** Joined the set on this connection: once the clocks' offset is known, so what's played from the session is in time from the start. */
let joined = false;
/** This device led the session: after a reload or a dropped connection, it takes the lead back. */
let wantLead = false;

function storedSync(): { setId?: string; lead?: boolean } | null {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as { setId?: string; lead?: boolean } | null;
  } catch {
    return null;
  }
}

/** What's kept for after a reload: the set, and whether this device led it. */
function keep() {
  try {
    if (state.setId) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ setId: state.setId, lead: wantLead }));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: it lasts for this page.
  }
}

function send(message: SyncClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function ping() {
  send({ type: "ping", id: ++pingId, sent: deviceNow() });
}

function connect() {
  if (typeof window === "undefined" || !state.setId) return;
  socket?.close();
  emit({ status: "connecting" });
  const ws = new WebSocket(`${getApiUrl().replace(/^http/, "ws").replace(/\/$/, "")}${SYNC_PATH}`);
  socket = ws;
  ws.onopen = () => {
    void apiToken().then((token) => {
      if (socket !== ws) return;
      if (!token) return emit({ error: "signed-out" });
      send({ type: "hello", token });
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
    stopTimers();
    if (!state.setId) return;
    // Dropped: the metronome keeps going on its own; back as soon as possible.
    emit({ status: "connecting" });
    retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** retries++));
  };
}

function stopTimers() {
  if (pingTimer) clearInterval(pingTimer);
  if (resyncTimer) clearInterval(resyncTimer);
  pingTimer = resyncTimer = null;
}

function receive(message: SyncServerMessage) {
  switch (message.type) {
    case "ready": {
      retries = 0;
      userId = message.userId;
      joined = false;
      for (let i = 0; i < FIRST_PINGS; i++) setTimeout(ping, i * 120);
      pingTimer = setInterval(ping, EARLY_PING_MS);
      const early = pingTimer;
      setTimeout(() => {
        if (pingTimer !== early) return;
        clearInterval(early);
        pingTimer = setInterval(ping, PING_EVERY_MS);
      }, EARLY_PINGS_FOR_MS);
      resyncTimer = setInterval(resync, RESYNC_MS);
      return;
    }
    case "pong": {
      samples = [...samples, { sent: message.sent, at: message.at, received: deviceNow() }].slice(-SAMPLES_KEPT);
      const measured = clockOffset(samples);
      if (!measured) return;
      const moved = state.offset === null || Math.abs(measured.offset - state.offset) > 2;
      emit({ offset: measured.offset });
      if (!joined && samples.length >= 4) {
        joined = true;
        send({ type: "join", setId: state.setId!, deviceId: syncDeviceId() });
        rejoining = true;
      } else if (moved && joined) applySession();
      return;
    }
    case "session": {
      if (message.setId !== state.setId) return;
      const wasLeading = state.leading;
      // Led it before a reload or a dropped connection: the lead back.
      if (wantLead && !message.leading && message.canLead && (!message.session || message.session.leader.id === userId)) send({ type: "lead" });
      // Someone else took over, or the session ended: not ours to take back.
      else if (wantLead && !message.leading && (!message.session || message.session.leader.id !== userId)) {
        wantLead = false;
        keep();
      }
      if (message.leading) {
        wantLead = true;
        keep();
      }
      // In the set again (issue #247): what didn't get an answer goes again.
      if (rejoining) {
        rejoining = false;
        commands.rejoined();
      }
      // What the screens show, as the server has it (issue #305): what this device's next command is based on -
      // unless slides from here are still on their way, then those.
      if (!commands.sending) {
        presentRev = message.session?.presentingRev ?? 0;
        presentShown = message.session?.presenting ?? null;
      }
      heldScreens = resumeScreens(message, userId, heldScreens, (control) => send({ type: "screens", control }));
      door.heard(message.pulse);
      emit({
        status: "on",
        error: null,
        session: message.session,
        members: message.members,
        leading: message.leading,
        canLead: message.canLead,
        stage: message.stage ?? null,
        screensMine: !!message.screensMine,
        // An older server doesn't say: the leader, unless locked out, and who runs the screens.
        canOperate: message.canOperate ?? message.canLead,
        canPresent: message.canPresent ?? (!!message.screensMine || (message.leading && !(message.session?.screens?.exclusive && !message.screensMine))),
        canCue: !!message.canCue,
        canRoute: message.canRoute ?? message.canOperate ?? message.canLead,
      });
      setMetronomeStartDelay(message.leading ? LEADER_START_DELAY : 0.08);
      // Just took the lead: the metronome carries on as it was (followed, or the session's), and goes out.
      if (message.leading && !wasLeading) {
        takeOverMetronome(sessionTimeline());
        unfollowStems();
        lastSent = null;
        lastStemsSent = null;
        publishMetronome(getMetronomeState());
        publishStems(getStemState());
      }
      applySession();
      return;
    }
    case "ack":
      if (commands.receive(message)) emit({});
      return;
    case "pass":
      if (message.setId !== state.setId) return;
      door.passed(message.pass, message.expiresAt);
      emit({});
      return;
    case "error": {
      if (commands.receive(message) && !commands.sending) {
        // Refused: what the screens show is the server's again, and the next slide is based on it.
        presentRev = serverSession?.presentingRev ?? 0;
        presentShown = serverSession?.presenting ?? null;
      }
      if (message.code === "unauthorized") forgetApiToken();
      if (message.code === "not-found") return disableSync();
      // Someone else moved the screens first (issue #305), or the session started again since: the session that follows has where they are.
      if (message.code === "stale" || message.code === "epoch") return emit({});
      emit({ error: message.message });
      return;
    }
  }
}

/** Following: the leader's metronome, placed on this device's clock. */
function applySession() {
  const { session, leading, offset } = state;
  if (!session || leading || !following) {
    if (!leading) {
      unfollowMetronome();
      unfollowStems();
    }
    return;
  }
  if (offset === null) return;
  followMetronome(sessionTimeline(), session.leader.name);
  applyStems(session.leader.name);
}

// --- the leader's stems (issue #100)

/** A song's stems as this device sees them (its own files of it), online or kept on the device; null when it has none. */
const stemSongs = new Map<string, Promise<StemSong | null>>();
/** The leader's multitrack of the song (issue #123), when this device sees it; its original stems (or recording) for null. */
function stemSongFor(songVersionId: string, multitrackId: string | null, title: string, source?: SyncStems["source"]): Promise<StemSong | null> {
  const key = `${songVersionId}|${multitrackId ?? ""}|${source ?? ""}`;
  let song = stemSongs.get(key);
  if (!song) {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    song = songFiles(songVersionId)
      .then(({ attachments, offline }) => {
        // Without the takes when the leader plays the stems alone (issue #366).
        const stems = filesForSource(playableOf(attachments, multitrackId, true), source ?? "TAKES");
        if (stems.length === 0) return null;
        return { songVersionId, title, returnTo, stems, multitrackId, source, load: fileLoader(songVersionId, offline) } satisfies StemSong;
      })
      .catch(() => null);
    stemSongs.set(key, song);
  }
  return song;
}

/** Following: the leader's stems, placed on this device's clock. */
function applyStems(leader: string) {
  const stems = state.session?.stems;
  if (!stems || state.offset === null) return void followStems(null, null, leader);
  const timeline = { playing: stems.playing, position: stems.position, epoch: stems.anchorAt - state.offset };
  void stemSongFor(stems.songVersionId, stems.multitrackId ?? null, stems.title, stems.source).then((song) => {
    // Still the leader's, once the files are listed.
    const now = state.session?.stems;
    if (now?.songVersionId !== stems.songVersionId || (now.multitrackId ?? null) !== (stems.multitrackId ?? null) || now.source !== stems.source || state.leading) return;
    // Transposed as the leader's (issue #129).
    const transpose = stems.transpose ?? 0;
    const transposeParts = stems.transposeParts ?? {};
    void setStemsTranspose(transpose, transposeParts);
    // At the leader's speed (issue #139): the timeline is in the recording's time.
    const speed = stems.speed ?? 1;
    void setStemsSpeed(speed);
    void followStems(song ? { ...song, transpose, transposeParts, speed } : null, song ? timeline : null, leader);
  });
}

let lastStemsSent: string | null = null;

/** Leading: the stems' play, pause and seek go out. */
function publishStems(stems: StemState) {
  if (!state.leading || state.offset === null) return;
  const payload =
    stems.songVersionId && (stems.playing || stems.status === "ready")
      ? {
          songVersionId: stems.songVersionId,
          multitrackId: stems.multitrackId,
          ...(stems.source ? { source: stems.source } : {}),
          transpose: stems.transpose,
          transposeParts: stems.transposeParts,
          ...(stems.speed !== 1 ? { speed: stems.speed } : {}),
          title: stems.title,
          playing: stems.playing && !!stems.anchor,
          position: stems.playing && stems.anchor ? stems.anchor.position : stems.position,
          anchorAt: stems.playing && stems.anchor ? Math.round((stems.anchor.epoch + state.offset) * 10) / 10 : 0,
        }
      : null;
  const key = JSON.stringify(payload);
  if (key === lastStemsSent) return;
  lastStemsSent = key;
  send({ type: "update", stems: payload });
}

/** The session's metronome, on this device's clock. */
function sessionTimeline(): FollowedTimeline | null {
  const metronome = state.session?.metronome;
  if (!metronome || state.offset === null) return null;
  return { settings: metronome.settings, playing: metronome.playing, anchorEpoch: metronome.anchorAt - state.offset, anchorPosition: metronome.anchorPosition };
}

// --- leading: the metronome's changes go out

let lastSent: string | null = null;

function publishMetronome(metronome: MetronomeState) {
  if (!state.leading || state.offset === null) return;
  const payload =
    metronome.playing && metronome.anchor
      ? {
          settings: sharedMetronomeSettings(metronome.settings),
          playing: true,
          anchorAt: Math.round((metronome.anchor.epoch + state.offset) * 10) / 10,
          anchorPosition: metronome.anchor.position,
        }
      : { settings: sharedMetronomeSettings(metronome.settings), playing: false, anchorAt: 0, anchorPosition: 0 };
  const key = JSON.stringify(payload);
  if (key === lastSent) return;
  lastSent = key;
  send({ type: "update", metronome: payload });
}

/** Every so often: the leader says again where the beat is (on the clocks as they are now); a follower re-places it. */
function resync() {
  if (state.leading) {
    // Its own audio kept where its anchor says; the anchor sent again if the clocks' offset has moved.
    realignMetronome();
    realignStems();
    const stems = getStemState();
    if (stems.playing && stems.anchor && state.offset !== null && state.session?.stems?.playing && Math.abs(state.session.stems.anchorAt - (stems.anchor.epoch + state.offset)) > 2) {
      lastStemsSent = null;
      publishStems(stems);
    }
    const metronome = getMetronomeState();
    if (!metronome.playing || !metronome.anchor || state.offset === null || !state.session?.metronome) return;
    const shared = state.session.metronome;
    if (shared.anchorPosition === metronome.anchor.position && Math.abs(shared.anchorAt - (metronome.anchor.epoch + state.offset)) <= 2) return;
    lastSent = null;
    publishMetronome(metronome);
  } else applySession();
}

// --- what pages call

/** Turns sync on for a set (from a press: the metronome may make sound then). */
export function enableSync(setId: string, lead = false, { follow = true }: { follow?: boolean } = {}) {
  if (state.setId === setId && state.status !== "off") {
    // From the operator's page to Live: playing along now.
    if (follow && !following) {
      following = true;
      applySession();
    }
    return;
  }
  following = follow;
  disableSync();
  samples = [];
  wantLead = lead;
  setStemsDirectOutput(true);
  emit({ setId, status: "connecting", session: null, members: [], leading: false, canLead: false, error: null, offset: null, stage: null, screensMine: false, canPresent: false, canOperate: false });
  keep();
  connect();
}

export function disableSync() {
  wantLead = false;
  heldScreens = null;
  commands.clear();
  door.clear();
  if (retry) clearTimeout(retry);
  retry = null;
  stopTimers();
  // Left on purpose: screens it ran are the leader's at once, not kept for it to come back.
  send({ type: "leave" });
  const ws = socket;
  socket = null;
  ws?.close();
  if (state.setId) {
    unfollowMetronome();
    unfollowStems();
  }
  setStemsDirectOutput(false);
  stemSongs.clear();
  setMetronomeStartDelay(0.08);
  lastSent = null;
  lastStemsSent = null;
  emit({ setId: null, status: "off", session: null, members: [], leading: false, canLead: false, error: null, offset: null, stage: null, screensMine: false, canPresent: false, canOperate: false });
  following = true;
  keep();
}

/** Starts a session for the set, or takes over its lead. */
export function leadSync() {
  wantLead = true;
  keep();
  send({ type: "lead" });
}

/** Ends the set's session for everyone: their metronome stops. */
export function endSync() {
  wantLead = false;
  keep();
  send({ type: "end" });
}

/**
 * What the set's screens show (issues #186, #305) - a slide of an item,
 * black, or nothing (null: not presenting) - from Live, for whoever may
 * present.
 */
export function publishPresenting(presenting: SyncPresenting | null) {
  presentScreens(presenting);
}

/**
 * What the screens show, as this device last had it (issue #305): its
 * revision and slide - the session's, then each command it sends, taken to
 * succeed - so a command says what it's based on and two quick ones from
 * here aren't refused as stale. A refusal is followed by the session, which
 * puts them back.
 */
let presentRev = 0;
let presentShown: SyncPresenting | null = null;

/** Leading: lets someone in the set present beside the leader, or (false) no longer (issue #305). */
export function allowPresenter(userId: string, allow: boolean) {
  if (state.leading) send({ type: "presenter", userId, allow });
}

/** The media operator (issue #275) takes the screens, shared or alone, or (null) gives them back. */
export function takeScreens(control: "shared" | "exclusive" | null) {
  if (!state.canOperate && !state.canPresent) return;
  if (control === null) heldScreens = null;
  send({ type: "screens", control });
}

/** What the screens show (issues #275, #305), based on what they showed: from anyone who may present. */
export function presentScreens(presenting: SyncPresenting | null) {
  if (!state.canPresent || samePresenting(presenting, presentShown)) return;
  commands.submit({ kind: "present", presenting, basedOn: presentRev }, serverSession?.epoch);
  presentRev += 1;
  presentShown = presenting;
  emit({});
}


/**
 * The screens to the next or previous song or section (issue #322): from
 * someone who may cue - a singer - where to is worked out by the session from
 * the set. Based on what they showed: pressed twice before the screens moved,
 * the second is refused, and the session says where they are.
 */
export function cueScreens(direction: "next" | "previous", to: "item" | "section") {
  if (!state.canCue) return;
  commands.submit({ kind: "cue", direction, to, basedOn: presentRev }, serverSession?.epoch);
  emit({});
}

/** The media operator (issue #269): the set's timer and message for its screens; anyone who can lead the set, leading or not - and their layers, someone who routes them. */
export function sendStage(command: SyncStageCommand) {
  if (state.canOperate || (state.canRoute && stageOnlyLayers(command))) send({ type: "stage", ...command });
}

/** Leading: the set's song the leader has open, for the others to follow. */
export function publishSyncItem(itemId: string) {
  if (state.leading && state.session?.itemId !== itemId) send({ type: "update", itemId });
}

/** Leading: what plays with a song of the set, for everyone (issue #366); null leaves it to each person again. */
export function publishPlayback(itemId: string, source: PlaybackSource | null) {
  if (!state.leading || (state.session?.playback?.[itemId] ?? null) === source) return;
  send({ type: "update", playback: { [itemId]: source } });
}

/** Sync's state now, outside React. */
export function syncState(): SyncState {
  return state;
}

export function useSync(): SyncState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

/**
 * In the app, once: sync back on after a reload, and the leader's
 * metronome sent out as it changes.
 */
export function useSyncBridge() {
  const metronome = useMetronome();
  const stems = useStems();
  useEffect(() => {
    const kept = storedSync();
    if (kept?.setId && state.status === "off") enableSync(kept.setId, !!kept.lead);
  }, []);
  useEffect(() => {
    if (!metronome.following) publishMetronome(metronome);
  }, [metronome]);
  // Its position ticks along while it plays: only a start, pause, seek, another song or multitrack, a transposition or a speed goes out.
  const stemsKey = JSON.stringify([
    stems.songVersionId,
    stems.multitrackId,
    stems.status,
    stems.playing,
    stems.anchor,
    stems.playing ? 0 : stems.position,
    stems.following,
    stems.transpose,
    stems.transposeParts,
    stems.speed,
  ]);
  useEffect(() => {
    if (!stems.following) publishStems(getStemState());
  }, [stemsKey]);
}

/** What Sync play knows of the clocks, for Sync details (issue #101). */
export function syncReport() {
  const best = clockOffset(samples);
  return {
    status: state.status,
    leading: state.leading,
    offset: state.offset,
    rtt: best?.rtt ?? null,
    lastRtt: samples.length ? samples[samples.length - 1]!.received - samples[samples.length - 1]!.sent : null,
    pings: samples.length,
    members: state.members.length,
  };
}

/** From a press: the browser lets the leader's metronome and stems make sound. */
export function unlockSyncAudio() {
  unlockMetronomeAudio();
  unlockStemsAudio();
}

/**
 * On a set's song (its page or Live): leading, the song goes out; following,
 * the page goes to the leader's song when it changes.
 */
export function useSyncSong(setId: string, itemId: string, go: (itemId: string) => void) {
  const sync = useSync();
  const on = sync.setId === setId && sync.status === "on";
  useEffect(() => {
    if (on && sync.leading) publishSyncItem(itemId);
  }, [on, sync.leading, itemId]);
  const leaderItem = on && !sync.leading ? (sync.session?.itemId ?? null) : null;
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (leaderItem && leaderItem !== itemId) goRef.current(leaderItem);
    // Only when the leader moves: the follower may look at another song meanwhile.
  }, [leaderItem]);
}
