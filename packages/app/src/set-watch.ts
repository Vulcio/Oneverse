import { SYNC_PATH, type SyncClientMessage, type SyncServerMessage } from "@oneverse/core";
import { apiToken, forgetApiToken } from "./api-client";
import { getApiUrl } from "./public-env";

/** Changes close together are read once. */
const SETTLE_MS = 150;

/**
 * Told when a set changes (issue #521), from any app - its songs, their
 * order, its name - without joining it: a running order open in the Oneverse
 * app and in Songverse stays the same in both. Its own connection to the
 * API's /sync, signed in with the API token, back after a drop. Returns how
 * to stop.
 */
export function watchSet(setId: string, onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let stopped = false;

  const send = (message: SyncClientMessage) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  function connect() {
    if (stopped) return;
    const ws = new WebSocket(`${getApiUrl().replace(/^http/, "ws").replace(/\/$/, "")}${SYNC_PATH}`);
    socket = ws;
    ws.onopen = () => {
      void apiToken().then((token) => {
        if (socket !== ws || !token) return;
        send({ type: "hello", token });
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
        // Back after a drop: what changed meanwhile is read again.
        if (retries > 0) onChange();
        retries = 0;
        send({ type: "watch-set", setId });
      } else if (message.type === "set-changed" && message.setId === setId) {
        if (settle) clearTimeout(settle);
        settle = setTimeout(onChange, SETTLE_MS);
      } else if (message.type === "error" && message.code === "unauthorized") {
        forgetApiToken();
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      if (!stopped) retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** retries++));
    };
  }

  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (settle) clearTimeout(settle);
    const ws = socket;
    socket = null;
    ws?.close();
  };
}
