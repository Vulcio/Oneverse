import { LiveEngine, SYNC_PATH, type SyncClientMessage, type SyncServerMessage } from "@oneverse/core";

/**
 * Oneverse Pulse's link to the cloud (issue #247, docs/live-session.md,
 * "Pulse: offline and back"): in a set's session as a device of its own,
 * mirroring it (LiveEngine.mirror) while the cloud's there. When the cloud's
 * gone for longer than `outageMs`, the room runs the session (takeOver);
 * when it's back, the room's session goes to it first (handback), and Pulse
 * mirrors the cloud again once it's taken. No timers of its own beyond
 * reconnecting: the room's devices talk to the engine through Pulse's
 * server, not through here.
 */

/** The cloud gone this long (ms): the room runs the session. A Wi-Fi blip shorter than it changes nothing. */
export const OUTAGE_MS = 10_000;

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
  /** The set it mirrors. */
  setId: string;
  /** This Pulse's id: its device in the set, and its authority ("pulse:<node id>"). */
  nodeId: string;
  /** A token to sign in to the cloud with; null: none now. */
  token: () => Promise<string | null>;
  outageMs?: number;
  /** Opens a WebSocket (Node's own by default). */
  open?: (url: string) => LinkSocket;
  /** What happened, for Pulse's log. */
  log?: (line: string) => void;
}

const OPEN = 1;

export class CloudLink {
  readonly engine: LiveEngine;
  private socket: LinkSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private outage: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private stopped = true;
  private current: LinkStatus = "connecting";
  private readonly listeners = new Set<(status: LinkStatus) => void>();

  constructor(private readonly options: CloudLinkOptions) {
    this.engine = new LiveEngine(options.nodeId);
  }

  get status(): LinkStatus {
    return this.current;
  }

  /** Told each time the status changes. */
  onStatus(listener: (status: LinkStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
        if (!token) return this.options.log?.("cloud link: no token to sign in with");
        this.send({ type: "hello", token });
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
      this.dropped();
    };
  }

  /** The cloud's gone: back as soon as it can be; the room runs the session if it stays gone. */
  private dropped() {
    if (this.stopped) return;
    if (!this.engine.runs) this.set("connecting");
    this.outage ??= setTimeout(() => {
      this.outage = null;
      if (this.current !== "online" && this.engine.takeOver()) {
        this.options.log?.(`cloud link: the room runs session ${this.engine.state?.sessionId} (epoch ${this.engine.state?.epoch})`);
        this.set("room");
      }
    }, this.options.outageMs ?? OUTAGE_MS);
    this.retry = setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.retries++));
  }

  private receive(message: SyncServerMessage) {
    switch (message.type) {
      case "ready": {
        this.retries = 0;
        if (this.outage) clearTimeout(this.outage);
        this.outage = null;
        this.send({ type: "join", setId: this.options.setId, deviceId: this.options.nodeId });
        // Back after running the session: the room's goes first, and Pulse mirrors again once it's taken.
        const handback = this.engine.handBack();
        if (handback) this.send({ type: "handback", handback });
        else this.mirror();
        return;
      }
      case "session":
        if (message.setId !== this.options.setId || message.live === undefined) return;
        this.engine.mirror(message.live);
        return;
      case "handedBack":
        this.options.log?.(`cloud link: the cloud took session ${message.sessionId} back (epoch ${message.epoch})`);
        this.engine.handedBack();
        this.mirror();
        return;
      case "error":
        // The cloud wouldn't take it (it went on with another session, or took it already): it's the cloud's.
        if (this.engine.runs && message.code === "stale" && message.id === undefined) {
          this.options.log?.(`cloud link: the cloud kept its own session: ${message.message}`);
          this.engine.handedBack();
          this.mirror();
          return;
        }
        this.options.log?.(`cloud link: ${message.code}: ${message.message}`);
        return;
    }
  }

  private mirror() {
    this.send({ type: "mirror" });
    this.set("online");
  }
}
