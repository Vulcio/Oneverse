import { SCREEN_REPORT_EVERY_MS, SYNC_PATH, slideKey, type ScreenCurrent, type SyncPresenting, type SyncServerMessage, type SyncStage } from "@oneverse/core";
import { useEffect, useRef, useState } from "react";
import { getApiUrl } from "@oneverse/app/public-env";
import { screenReport } from "./screen-report";
import { setItemView } from "./set-items";

/**
 * A screen's side of issue #186, in the browser of whatever drives the big
 * screen: no sign-in. With no token yet, it asks for a pairing code and waits
 * for someone to confirm it; with one, it loads its set and follows what's
 * presented over /sync, reconnecting when that drops. Disconnected from a
 * phone, it forgets its token and shows a new code.
 *
 * Profiles (issue #284): a screen paired again keeps a token for each
 * pairing - a venue's TV used by two churches - and shows one at a time,
 * picked from its menu; the one shown last comes back after a reload. A
 * profile disconnected, or whose temporary pairing ended, is forgotten and
 * the screen shows another, or a new code.
 */

const TOKEN_KEY = "songverse.screen.token";
/** Its profiles (issue #284), JSON: each one's token and what it was last called, for its menu. TOKEN_KEY is the one shown. */
const PROFILES_KEY = "songverse.screen.profiles";
/** Sent on the window when the menu picks another profile or asks for a code (issue #284). */
const PROFILE_EVENT = "sv-screen-profile";
const PAIR_EVENT = "sv-screen-pair";
const CLAIM_EVERY_MS = 2000;
const PING_EVERY_MS = 10_000;
/** The first report (issue #286): once the screen has drawn for a while, so it has a frame rate to tell. */
const REPORT_FIRST_MS = 5_000;
/** The set's songs reloaded this often (a song edited, one added). */
const RELOAD_EVERY_MS = 2 * 60_000;

export type ScreenDisplayState =
  | { kind: "starting" }
  /** `adding`: another profile, beside those it has - it can go back to them. */
  | { kind: "pairing"; code: string; expiresAt: string; adding: boolean }
  | {
      kind: "showing";
      current: ScreenCurrent;
      presenting: SyncPresenting | null;
      online: boolean;
      /** The media operator's timer and message (issue #269). */
      stage: SyncStage | null;
      /** The server's clock less this device's (ms), from its pings: the operator's timer is on the server's. */
      offset: number;
    }
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
  if (token && !storedProfiles().some((one) => one.token === token)) keepProfiles([...storedProfiles(), { token, name: "", owner: "" }]);
}

/** One of the screen's pairings (issue #284): its token, and its name and owner's as last loaded. */
export interface ScreenProfile {
  token: string;
  name: string;
  owner: string;
}

function storedProfiles(): ScreenProfile[] {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? "[]") as unknown;
    return Array.isArray(stored) ? stored.filter((one): one is ScreenProfile => typeof one?.token === "string").map((one) => ({ token: one.token, name: String(one.name ?? ""), owner: String(one.owner ?? "") })) : [];
  } catch {
    return [];
  }
}

function keepProfiles(profiles: ScreenProfile[]) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // Storage blocked: the one shown only.
  }
}

/** The screen's profiles, the one shown marked, for its menu (issue #284). */
export function screenProfiles(): { profiles: Omit<ScreenProfile, "token">[]; current: number } {
  const token = storedToken();
  const profiles = storedProfiles();
  return { profiles: profiles.map(({ name, owner }) => ({ name, owner })), current: profiles.findIndex((one) => one.token === token) };
}

/** Shows another of its profiles (issue #284), by its place in screenProfiles(). */
export function showScreenProfile(index: number) {
  const profile = storedProfiles()[index];
  if (!profile) return;
  keepToken(profile.token);
  window.dispatchEvent(new Event(PROFILE_EVENT));
}

/** Shows a code to pair it again (issue #284), for another profile beside its own. */
export function pairScreenAgain() {
  window.dispatchEvent(new Event(PAIR_EVENT));
}

/** Back from showing a code for another profile (issue #284): the one it showed. */
export function stopPairingAgain() {
  window.dispatchEvent(new Event(PROFILE_EVENT));
}

/** The profile shown is forgotten (disconnected, or its pairing ended): the token of another to show, or null. */
function forgetShown(): string | null {
  const token = storedToken();
  const left = storedProfiles().filter((one) => one.token !== token);
  keepProfiles(left);
  const next = left[left.length - 1]?.token ?? null;
  keepToken(next);
  return next;
}

/** What the profile shown is called now, for the menu. */
function nameShown(name: string, owner: string) {
  const token = storedToken();
  const profiles = storedProfiles();
  if (profiles.some((one) => one.token === token && (one.name !== name || one.owner !== owner))) keepProfiles(profiles.map((one) => (one.token === token ? { ...one, name, owner } : one)));
}

/** Where a screen's token travels to another address (issue #305): the fragment, never sent to a server. */
const HAND_OFF = "screen";

/**
 * The address to open this screen at elsewhere, keeping its pairing (issue
 * #305: Songverse's /screen moved to the screen app): `target` with the
 * token in its fragment, or `target` alone when it isn't paired.
 */
export function screenHandOff(target: string): string {
  const token = storedToken();
  return token ? `${target}#${new URLSearchParams({ [HAND_OFF]: token })}` : target;
}

/** A token handed over in the address (screenHandOff): kept, and taken out of the address. */
function adoptHandedToken() {
  try {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(HAND_OFF);
    if (!token) return;
    keepToken(token);
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  } catch {
    // Not one: nothing to keep.
  }
}

const api = (path: string) => `${getApiUrl().replace(/\/$/, "")}${path}`;

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** The screen's own date (YYYY-MM-DD) and time (HH:MM), as its clock has them. */
export function screenNow(): { today: string; time: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}:${pad(now.getMinutes())}` };
}

/** A set a screen offers to pick (issue #274). */
export interface ScreenSetOption {
  id: string;
  name: string | null;
  eventDate: string | null;
  fromEvent: boolean;
  teamName: string | null;
}

export interface ScreenSets {
  setMode: "FIXED" | "DAY";
  setlistId: string | null;
  /** Picked on the screen today, rather than the day's own. */
  picked: boolean;
  upcoming: ScreenSetOption[];
  undated: ScreenSetOption[];
  archive: ScreenSetOption[];
}

/** The owner's sets, to pick one on the screen (issue #274). */
export async function fetchScreenSets(): Promise<ScreenSets | null> {
  const token = storedToken();
  if (!token) return null;
  const response = await fetch(api(`/screens/current/sets?today=${screenNow().today}`), { headers: { Authorization: `Screen ${token}` } }).catch(() => null);
  return response?.ok ? json<ScreenSets>(response) : null;
}

/** A set picked on the screen for today, or (null) back to the day's own; the screen loads it again when the server says so. */
export async function pickScreenSet(setlistId: string | null): Promise<boolean> {
  const token = storedToken();
  if (!token) return false;
  const response = await fetch(api("/screens/current/set"), {
    method: "POST",
    headers: { Authorization: `Screen ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ setlistId, today: screenNow().today }),
  }).catch(() => null);
  return !!response?.ok;
}

export interface ScreenThemeOptions {
  themeId: string | null;
  themeTemplate: string | null;
  /** Its owner's saved themes (issue #276). */
  themes: { id: string; name: string; teamName: string | null }[];
}

/** The themes the screen offers (issue #276). */
export async function fetchScreenThemes(): Promise<ScreenThemeOptions | null> {
  const token = storedToken();
  if (!token) return null;
  const response = await fetch(api("/screens/current/themes"), { headers: { Authorization: `Screen ${token}` } }).catch(() => null);
  return response?.ok ? json<ScreenThemeOptions>(response) : null;
}

/** A theme picked on the screen - saved, built-in, or (both null) the default look; the screen loads it again when the server says so. */
export async function pickScreenTheme(pick: { themeId: string | null; themeTemplate: string | null }): Promise<boolean> {
  const token = storedToken();
  if (!token) return false;
  const response = await fetch(api("/screens/current/theme"), {
    method: "POST",
    headers: { Authorization: `Screen ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(pick),
  }).catch(() => null);
  return !!response?.ok;
}

export function useScreenDisplay(): ScreenDisplayState {
  const [state, setState] = useState<ScreenDisplayState>({ kind: "starting" });
  const [token, setToken] = useState<string | null | undefined>(undefined);
  /** Showing a code for another profile (issue #284), its own still kept. */
  const [adding, setAdding] = useState(false);
  const presenting = useRef<SyncPresenting | null>(null);
  const stage = useRef<SyncStage | null>(null);
  const offset = useRef(0);

  // The token kept from last time, or handed over from Songverse's /screen, once in the browser.
  useEffect(() => {
    adoptHandedToken();
    setToken(storedToken());
    // Another profile picked from the menu, or a code asked for (issue #284).
    const switched = () => {
      setAdding(false);
      setToken(storedToken());
    };
    const pairAgain = () => setAdding(true);
    window.addEventListener(PROFILE_EVENT, switched);
    window.addEventListener(PAIR_EVENT, pairAgain);
    return () => {
      window.removeEventListener(PROFILE_EVENT, switched);
      window.removeEventListener(PAIR_EVENT, pairAgain);
    };
  }, []);

  // No token, or another profile asked for: a code to show, until someone confirms it.
  useEffect(() => {
    if (token !== null && !adding) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function pair() {
      try {
        const pairing = await json<{ pairingId: string; code: string; secret: string; expiresAt: string }>(await fetch(api("/screens/pairings"), { method: "POST" }));
        if (stopped) return;
        setState({ kind: "pairing", code: pairing.code, expiresAt: pairing.expiresAt, adding: token !== null });
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
            setAdding(false);
            setToken(claimed);
            return;
          }
          // Expired: a new code - or, for another profile, back to the one it showed.
          if (response?.status === 410) return token !== null ? setAdding(false) : void pair();
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
  }, [token, adding]);

  // A token: its set, and what's presented on it.
  useEffect(() => {
    if (!token || adding) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    let pinger: ReturnType<typeof setInterval> | null = null;
    let reporter: ReturnType<typeof setInterval> | null = null;
    let firstReport: ReturnType<typeof setTimeout> | null = null;
    let current: ScreenCurrent | null = null;
    let online = false;
    /** The words last loaded again for: a key this screen still can't match isn't fetched over and over. */
    let reloadedFor: string | null = null;

    // Disconnected, or its pairing ended (issue #284): another profile, or a new code.
    const forget = () => setToken(forgetShown());
    const show = () => {
      if (current) setState({ kind: "showing", current, presenting: presenting.current, online, stage: stage.current, offset: offset.current });
    };
    async function load() {
      // Its own day and time: a screen following its owner's schedule shows the set of the day (issue #274).
      const { today, time } = screenNow();
      const response = await fetch(api(`/screens/current?today=${today}&time=${time}`), { headers: { Authorization: `Screen ${token}` } }).catch(() => null);
      if (stopped) return;
      if (response?.status === 404) return forget();
      if (!response?.ok) return;
      current = await json<ScreenCurrent>(response);
      nameShown(current.screen.name, current.screen.owner.name);
      show();
    }
    function connect() {
      const ws = new WebSocket(`${getApiUrl().replace(/^http/, "ws").replace(/\/$/, "")}${SYNC_PATH}`);
      socket = ws;
      ws.onopen = () => {
        retries = 0;
        ws.send(JSON.stringify({ type: "screen", token }));
        ws.send(JSON.stringify({ type: "ping", id: Date.now(), sent: Date.now() }));
        pinger = setInterval(() => ws.send(JSON.stringify({ type: "ping", id: Date.now(), sent: Date.now() })), PING_EVERY_MS);
        // What it is and how it's drawing (issue #286): once it has drawn a little, then every half minute.
        const report = () => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: "report", report: screenReport() }));
        firstReport = setTimeout(report, REPORT_FIRST_MS);
        reporter = setInterval(report, SCREEN_REPORT_EVERY_MS);
      };
      ws.onmessage = (event) => {
        let message: SyncServerMessage;
        try {
          message = JSON.parse(String(event.data)) as SyncServerMessage;
        } catch {
          return;
        }
        if (message.type === "error" && message.code === "disconnected") return forget();
        // Paired again from Screens (issue #284): a code shown for another profile.
        if (message.type === "pair-again") return setAdding(true);
        if (message.type === "screen") {
          // Another set, mode or name: loaded again.
          online = true;
          void load();
        }
        if (message.type === "pong") {
          // Half the round trip each way: near enough for a timer's seconds.
          const was = offset.current;
          offset.current = message.at - (message.sent + Date.now()) / 2;
          if (Math.abs(offset.current - was) > 500) show();
        }
        if (message.type === "session") {
          online = true;
          presenting.current = message.session?.presenting ?? null;
          stage.current = message.stage ?? null;
          // A song it doesn't have (added since), or whose words aren't the presenter's (edited since, issue #247): loaded again, once for those words.
          const itemId = presenting.current?.itemId;
          const view = itemId ? current?.set?.songs.find((song) => song.item.id === itemId) : undefined;
          const wanted = presenting.current?.slideKey;
          if (itemId && current?.set && !view) void load();
          else if (view && wanted && wanted !== reloadedFor && slideKey(setItemView(view).slides) !== wanted) {
            reloadedFor = wanted;
            void load();
          }
          show();
        }
      };
      ws.onclose = () => {
        if (pinger) clearInterval(pinger);
        if (reporter) clearInterval(reporter);
        if (firstReport) clearTimeout(firstReport);
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
      if (reporter) clearInterval(reporter);
      if (firstReport) clearTimeout(firstReport);
      socket?.close();
    };
  }, [token, adding]);

  return state;
}
