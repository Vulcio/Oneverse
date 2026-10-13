import { SYNC_PATH, type ScreenCurrent, type SyncPresenting, type SyncServerMessage } from "@songverse/core";
import { useEffect, useRef, useState } from "react";
import { getApiUrl } from "@songverse/app/public-env";

/**
 * A screen's side of issue #186, in the browser of whatever drives the big
 * screen: no sign-in. With no token yet, it asks for a pairing code and waits
 * for someone to confirm it; with one, it loads its set and follows what's
 * presented over /sync, reconnecting when that drops. Disconnected from a
 * phone, it forgets its token and shows a new code.
 */

const TOKEN_KEY = "songverse.screen.token";
const CLAIM_EVERY_MS = 2000;
const PING_EVERY_MS = 10_000;
/** The set's songs reloaded this often (a song edited, one added). */
const RELOAD_EVERY_MS = 2 * 60_000;

export type ScreenDisplayState =
  | { kind: "starting" }
  | { kind: "pairing"; code: string; expiresAt: string }
  | { kind: "showing"; current: ScreenCurrent; presenting: SyncPresenting | null; online: boolean }
  | { kind: "error"; message: string };

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function keepToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: paired until the page reloads.
  }
}

const api = (path: string) => `${getApiUrl().replace(/\/$/, "")}${path}`;

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function useScreenDisplay(): ScreenDisplayState {
  const [state, setState] = useState<ScreenDisplayState>({ kind: "starting" });
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const presenting = useRef<SyncPresenting | null>(null);

  // The token kept from last time, once in the browser.
  useEffect(() => setToken(storedToken()), []);

  // No token: a code to show, until someone confirms it.
  useEffect(() => {
    if (token !== null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function pair() {
      try {
        const pairing = await json<{ pairingId: string; code: string; secret: string; expiresAt: string }>(await fetch(api("/screens/pairings"), { method: "POST" }));
        if (stopped) return;
        setState({ kind: "pairing", code: pairing.code, expiresAt: pairing.expiresAt });
        const claim = async () => {
          if (stopped) return;
          const response = await fetch(api(`/screens/pairings/${pairing.pairingId}/claim`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: pairing.secret }),
          }).catch(() => null);
          if (stopped) return;
          if (response?.status === 201) {
            const { token: claimed } = await json<{ token: string }>(response);
            keepToken(claimed);
            setToken(claimed);
            return;
          }
          // Expired: a new code.
          if (response?.status === 410) return void pair();
          timer = setTimeout(() => void claim(), CLAIM_EVERY_MS);
        };
        timer = setTimeout(() => void claim(), CLAIM_EVERY_MS);
      } catch {
        if (stopped) return;
        setState({ kind: "error", message: "offline" });
        timer = setTimeout(() => void pair(), 5000);
      }
    }
    void pair();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  // A token: its set, and what's presented on it.
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    let pinger: ReturnType<typeof setInterval> | null = null;
    let current: ScreenCurrent | null = null;
    let online = false;

    const forget = () => {
      keepToken(null);
      setToken(null);
    };
    const show = () => {
      if (current) setState({ kind: "showing", current, presenting: presenting.current, online });
    };
    async function load() {
      const response = await fetch(api("/screens/current"), { headers: { Authorization: `Screen ${token}` } }).catch(() => null);
      if (stopped) return;
      if (response?.status === 404) return forget();
      if (!response?.ok) return;
      current = await json<ScreenCurrent>(response);
      show();
    }
    function connect() {
      const ws = new WebSocket(`${getApiUrl().replace(/^http/, "ws").replace(/\/$/, "")}${SYNC_PATH}`);
      socket = ws;
      ws.onopen = () => {
        retries = 0;
        ws.send(JSON.stringify({ type: "screen", token }));
        pinger = setInterval(() => ws.send(JSON.stringify({ type: "ping", id: Date.now(), sent: Date.now() })), PING_EVERY_MS);
      };
      ws.onmessage = (event) => {
        let message: SyncServerMessage;
        try {
          message = JSON.parse(String(event.data)) as SyncServerMessage;
        } catch {
          return;
        }
        if (message.type === "error" && message.code === "disconnected") return forget();
        if (message.type === "screen") {
          // Another set, mode or name: loaded again.
          online = true;
          void load();
        }
        if (message.type === "session") {
          online = true;
          presenting.current = message.session?.presenting ?? null;
          // A song it doesn't have (added since): loaded again.
          const itemId = presenting.current?.itemId;
          if (itemId && current?.set && !current.set.songs.some((song) => song.item.id === itemId)) void load();
          show();
        }
      };
      ws.onclose = () => {
        if (pinger) clearInterval(pinger);
        if (stopped || socket !== ws) return;
        online = false;
        show();
        retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** retries++));
      };
    }
    void load();
    connect();
    const reload = setInterval(() => void load(), RELOAD_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(reload);
      if (retry) clearTimeout(retry);
      if (pinger) clearInterval(pinger);
      socket?.close();
    };
  }, [token]);

  return state;
}
