import { LiveEngine, SYNC_PATH, type SyncClientMessage, type SyncServerMessage } from "@oneverse/core";

/**
 * Oneverse Pulse's link to the cloud (issue #247, docs/live-session.md,
 * "Pulse: offline and back"): signed in by its own token, paired like a
 * screen (issue #320), it's in the session of the set it's on - the one put
 * on it, or the event's on now at the location it follows - mirroring it
 * (LiveEngine.mirror) while the cloud's there. When the cloud's gone for
 * longer than `outageMs`, the room runs the session (takeOver); when it's
 * back, the room's session goes to it first (handback), and Pulse mirrors
 * the cloud again once it's taken. Its set changes when the cloud says so
 * (the next event at its location): the session it mirrors is then the new
 * set's. The room's devices talk to the engine through Pulse's server, not
 * through here.
 */

/** The cloud gone this long (ms): the room runs the session. A Wi-Fi blip shorter than it changes nothing. */
export const OUTAGE_MS = 10_000;

/** How often Pulse pings the cloud (ms): the cloud checks then whether it's still on the same set (the next event at its location). */
export const PING_MS = 30_000;

/** What the link needs of a WebSocket: the browser's and Node's (22) both are. */
export interface LinkSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

export type LinkStatus = "connecting" | "online" | "room";

export interface CloudLinkOptions {
  /** The API's address (https://api.oneverse.top). */
  apiUrl: string;
  /** This Pulse's id: its authority ("pulse:<node id>"). */
  nodeId: string;
  /** Its page's address on the venue's network (http://192.168.1.20:8788), told to the set's devices for "Continue on Pulse"; left out: not told. */
  roomUrl?: string;
  /** Its own token, from its pairing (issue #320); null: none yet. */
  token: () => Promise<string | null>;
  outageMs?: number;
  /** Opens a WebSocket (Node's own by default). */
  open?: (url: string) => LinkSocket;
  /** What happened, for Pulse's log. */
  log?: (line: string) => void;
}

const OPEN = 1;

export class CloudLink {
  private live: LiveEngine;
  private socket: LinkSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private outage: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private pings = 0;
  private set_: string | null = null;
  private name_: string | null = null;
  private retries = 0;
  private stopped = true;
  private current: LinkStatus = "connecting";
  private key: string | null = null;
  private readonly listeners = new Set<(status: LinkStatus) => void>();
  private readonly sessionListeners = new Set<() => void>();
  private readonly setListeners = new Set<(setId: string | null) => void>();

  constructor(private readonly options: CloudLinkOptions) {
    this.live = new LiveEngine(options.nodeId);
  }

  /** The session's engine: the set's it's on now. */
  get engine(): LiveEngine {
    return this.live;
  }

  get status(): LinkStatus {
    return this.current;
  }

  /** The set it's on, as the cloud last said; null before it said, or with none. Kept through an outage. */
  get setId(): string | null {
    return this.set_;
  }

  /** Its name in Screens, as the cloud last said. */
  get name(): string | null {
    return this.name_;
  }

  /** Told when it's put on another set (or none). */
  onSet(listener: (setId: string | null) => void): () => void {
    this.setListeners.add(listener);
    return () => this.setListeners.delete(listener);
  }

  /** The cloud's public key, which the room's passes are checked with (core's verifyLivePass); null until heard. Kept through an outage. */
  get passKey(): string | null {
    return this.key;
  }

  /** Told each time the status changes. */
  onStatus(listener: (status: LinkStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Told when the session changes from the cloud's side: what it says while it runs it, or its taking it back. */
  onSession(listener: () => void): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  private sessionChanged() {
    for (const listener of this.sessionListeners) listener();
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    for (const timer of [this.retry, this.outage]) if (timer) clearTimeout(timer);
    this.retry = this.outage = null;
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private set(status: LinkStatus) {
    if (status === this.current) return;
    this.current = status;
    this.options.log?.(`cloud link: ${status}`);
    for (const listener of this.listeners) listener(status);
  }

  private send(message: SyncClientMessage) {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  private connect() {
    if (this.stopped) return;
    const url = `${this.options.apiUrl.replace(/^http/, "ws").replace(/\/$/, "")}${SYNC_PATH}`;
    const socket = (this.options.open ?? ((address) => new WebSocket(address) as unknown as LinkSocket))(url);
    this.socket = socket;
    socket.onopen = () => {
      void this.options.token().then((token) => {
        if (this.socket !== socket) return;
        if (!token) return this.options.log?.("cloud link: not paired yet");
        this.send({ type: "screen", token });
      });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      let message: SyncServerMessage;
      try {
        message = JSON.parse(String(event.data)) as SyncServerMessage;
      } catch {
        return;
      }
      this.receive(message);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pinger) clearInterval(this.pinger);
      this.pinger = null;
      this.dropped();
    };
  }

  /** The cloud's gone: back as soon as it can be; the room runs the session if it stays gone. */
  private dropped() {
    if (this.stopped) return;
    if (!this.live.runs) this.set("connecting");
    this.outage ??= setTimeout(() => {
      this.outage = null;
      if (this.current !== "online" && this.live.takeOver()) {
        this.options.log?.(`cloud link: the room runs session ${this.live.state?.sessionId} (epoch ${this.live.state?.epoch})`);
        this.set("room");
        this.sessionChanged();
      }
    }, this.options.outageMs ?? OUTAGE_MS);
    this.retry = setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.retries++));
  }

  private receive(message: SyncServerMessage) {
    switch (message.type) {
      case "screen": {
        // Signed in, or told it's on another set: the cloud joined it to the set itself.
        if (!message.screen.pulse) {
          this.options.log?.("cloud link: this token is a screen's, not a Pulse's: pair it again as a Pulse");
          return;
        }
        const back = this.socketWasDown();
        this.name_ = message.screen.name;
        const setId = message.screen.setId;
        if (setId !== this.set_) {
          // Another set (the next event at its location): a session of its own. One the room ran meanwhile stays the room's record only.
          if (this.live.runs) this.options.log?.(`cloud link: on set ${setId ?? "none"} now; the room's session ${this.live.state?.sessionId} isn't handed back`);
          this.live = new LiveEngine(this.options.nodeId);
          this.set_ = setId;
          this.key = null;
          for (const listener of this.setListeners) listener(setId);
          this.mirror();
          return;
        }
        if (!back) return;
        // Back after running the session: the room's goes first, and Pulse mirrors again once it's taken.
        const handback = this.live.handBack();
        if (handback) this.send({ type: "handback", handback });
        else this.mirror();
        return;
      }
      case "session":
        if (message.setId !== this.set_ || message.live === undefined) return;
        this.live.mirror(message.live);
        if (!this.live.runs) this.sessionChanged();
        return;
      case "pass":
        if (message.setId === this.set_) this.key = message.key;
        return;
      case "handedBack":
        this.options.log?.(`cloud link: the cloud took session ${message.sessionId} back (epoch ${message.epoch})`);
        this.live.handedBack();
        this.mirror();
        return;
      case "error":
        if (message.code === "disconnected") {
          this.options.log?.("cloud link: this Pulse was disconnected in Screens: pair it again");
          return;
        }
        // The cloud wouldn't take it (it went on with another session, or took it already): it's the cloud's.
        if (this.live.runs && message.code === "stale" && message.id === undefined) {
          this.options.log?.(`cloud link: the cloud kept its own session: ${message.message}`);
          this.live.handedBack();
          this.mirror();
          return;
        }
        this.options.log?.(`cloud link: ${message.code}: ${message.message}`);
        return;
    }
  }

  /** The first word from the cloud since the socket opened: reconnected, so what was held meanwhile is sorted out now. */
  private socketWasDown(): boolean {
    if (this.pinger) return false;
    this.retries = 0;
    if (this.outage) clearTimeout(this.outage);
    this.outage = null;
    this.pinger = setInterval(() => this.send({ type: "ping", id: ++this.pings, sent: Date.now() }), PING_MS);
    return true;
  }

  private mirror() {
    this.sessionChanged();
    if (this.set_) {
      this.send({ type: "mirror", ...(this.options.roomUrl && { room: this.options.roomUrl }) });
      // Its own pass, for the cloud's key.
      this.send({ type: "pass" });
    }
    this.set("online");
  }
}
