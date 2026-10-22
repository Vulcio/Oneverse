import { clockOffset, resumeScreens, samePresenting, SYNC_PATH, syncDeviceId, type ClockSample, type SyncClientMessage, type SyncPresenting, type SyncServerMessage, type SyncStageCommand } from "@oneverse/core";
import { useSyncExternalStore } from "react";
import type { OperatorHost, OperatorLive } from "../host";

/** Pings kept for the clocks' offset, and how often one goes out. */
const SAMPLES_KEPT = 8;
const PING_EVERY_MS = 10_000;
/** This device's clock (ms), as Songverse's output clock reads it. */
const deviceNow = () => performance.timeOrigin + performance.now();

const OFF: OperatorLive = { ready: false, error: null, session: null, stage: null, members: [], leading: false, canLead: false, canPresent: false, canOperate: false, screensMine: false, offset: null };

/**
 * A live connection to a set for the operator's console alone (issue #305),
 * in an app that doesn't play along - the screen app's /operate: it joins the
 * set over the API's /sync, presents and runs the stage, and never leads
 * (no metronome, no stems). Songverse's console uses its own sync client.
 * `token` gives the API token, null when signed out.
 */
export function createLiveClient({ apiUrl, token }: { apiUrl: string; token: () => Promise<string | null> }) {
  let state = OFF;
  let setId: string | null = null;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let pinger: ReturnType<typeof setInterval> | null = null;
  let samples: ClockSample[] = [];
  let pingId = 0;
  // What the screens show, as this device last had it: what the next command is based on (see Songverse's sync client).
  let presentRev = 0;
  let presentShown: SyncPresenting | null = null;
  // The screens this device ran, to take back after a dropped connection (the server keeps them a minute), and who we are.
  let heldScreens: "shared" | "exclusive" | null = null;
  let userId: string | null = null;
  const listeners = new Set<() => void>();

  function emit(next: Partial<OperatorLive>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }

  function send(message: SyncClientMessage) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function ping() {
    send({ type: "ping", id: ++pingId, sent: deviceNow() });
  }

  function connect() {
    if (typeof window === "undefined" || !setId) return;
    const ws = new WebSocket(`${apiUrl.replace(/^http/, "ws").replace(/\/$/, "")}${SYNC_PATH}`);
    socket = ws;
    ws.onopen = () => {
      void token().then((value) => {
        if (socket !== ws) return;
        if (!value) return emit({ error: "signed-out" });
        send({ type: "hello", token: value });
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
      if (pinger) clearInterval(pinger);
      pinger = null;
      if (!setId) return;
      emit({ ready: false });
      retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** retries++));
    };
  }

  function receive(message: SyncServerMessage) {
    switch (message.type) {
      case "ready":
        retries = 0;
        userId = message.userId;
        send({ type: "join", setId: setId!, deviceId: syncDeviceId() });
        for (let i = 0; i < 4; i++) setTimeout(ping, i * 120);
        pinger = setInterval(ping, PING_EVERY_MS);
        return;
      case "pong": {
        samples = [...samples, { sent: message.sent, at: message.at, received: deviceNow() }].slice(-SAMPLES_KEPT);
        const measured = clockOffset(samples);
        if (measured) emit({ offset: measured.offset });
        return;
      }
      case "session":
        if (message.setId !== setId) return;
        presentRev = message.session?.presentingRev ?? 0;
        presentShown = message.session?.presenting ?? null;
        heldScreens = resumeScreens(message, userId, heldScreens, (control) => send({ type: "screens", control }));
        emit({
          ready: true,
          error: null,
          session: message.session,
          members: message.members,
          leading: message.leading,
          canLead: message.canLead,
          stage: message.stage ?? null,
          screensMine: !!message.screensMine,
          canOperate: message.canOperate ?? message.canLead,
          canPresent: message.canPresent ?? false,
        });
        return;
      case "error":
        // Someone else moved the screens first: the session that follows has where they are.
        if (message.code === "stale") return;
        emit({ error: message.message });
        return;
    }
  }

  const host: OperatorHost = {
    useLive: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => state,
        () => OFF,
      ),
    present(presenting) {
      if (!state.canPresent || samePresenting(presenting, presentShown)) return;
      send({ type: "present", presenting, basedOn: presentRev });
      presentRev += 1;
      presentShown = presenting;
    },
    takeScreens(control) {
      if (!state.canOperate) return;
      if (control === null) heldScreens = null;
      send({ type: "screens", control });
    },
    sendStage(command: SyncStageCommand) {
      if (state.canOperate) send({ type: "stage", ...command });
    },
  };

  return {
    host,
    /** Joins the set, leaving any other. */
    open(id: string) {
      if (setId === id) return;
      this.close();
      setId = id;
      samples = [];
      connect();
    },
    close() {
      // Left on purpose: screens it ran are the leader's at once, not kept for it to come back.
      send({ type: "leave" });
      setId = null;
      heldScreens = null;
      if (retry) clearTimeout(retry);
      if (pinger) clearInterval(pinger);
      retry = pinger = null;
      const ws = socket;
      socket = null;
      ws?.close();
      emit(OFF);
    },
  };
}

