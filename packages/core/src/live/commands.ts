import type { SyncClientMessage, SyncPresenting, SyncServerMessage, SyncSession } from "../sync/index.js";
import type { LiveCommandOp } from "./index.js";

/** A command sent and not yet answered: kept to send again after a dropped connection. */
export interface LivePendingCommand {
  id: string;
  op: LiveCommandOp;
  epoch?: number;
}

/** A command's id: random, as LIVE_COMMAND_ID takes it. */
export function liveCommandId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A device's commands to a set's live session (issue #247, docs/live-session.md),
 * the same in every client: each sent with an id and kept until the server
 * answers it, `ack` or an error carrying its id. Sent again when the device is
 * back in the set (`rejoined`), since a connection can die without anyone
 * knowing; the server applies a command once whatever happens, and answers a
 * resend as it answered the first. Until then the device shows what it asked
 * for (`view`), not the session from before it: a slide changed on a weak
 * connection doesn't jump back while it's on its way, and does when the
 * server refuses it.
 */
export class LiveCommands {
  private pending: LivePendingCommand[] = [];

  /** `send`: the message to the server, false when it couldn't go (no connection): it goes on `rejoined`. */
  constructor(
    private readonly send: (message: SyncClientMessage) => boolean,
    private readonly newId: () => string = liveCommandId,
  ) {}

  /** `op` sent, from the session at `epoch`. Its id. */
  submit(op: LiveCommandOp, epoch?: number): string {
    const command: LivePendingCommand = { id: this.newId(), op, ...(epoch !== undefined && { epoch }) };
    this.pending.push(command);
    this.send({ type: "command", ...command });
    return command.id;
  }

  /** A message from the server: true when it answered one of these commands (it's off the list). */
  receive(message: SyncServerMessage): boolean {
    if ((message.type !== "ack" && message.type !== "error") || !message.id) return false;
    const before = this.pending.length;
    this.pending = this.pending.filter((command) => command.id !== message.id);
    return this.pending.length !== before;
  }

  /** Back in the set after a dropped connection: every command not answered, sent again, in order. */
  rejoined() {
    for (const command of this.pending) this.send({ type: "command", ...command });
  }

  /** The set left: nothing more to send. */
  clear() {
    this.pending = [];
  }

  /** Whether some command is on its way. */
  get sending(): boolean {
    return this.pending.length > 0;
  }

  /** What the screens show, as this device asked for it last; undefined when nothing's on its way. */
  get presenting(): SyncPresenting | null | undefined {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const op = this.pending[i]!.op;
      if (op.kind === "present" || (op.kind === "tempo" && op.presenting !== undefined)) return op.presenting ?? null;
    }
    return undefined;
  }

  /** The session as this device shows it: the server's, with what it asked the screens to show while that's on its way. */
  view(session: SyncSession | null): SyncSession | null {
    const presenting = this.presenting;
    if (!session || presenting === undefined) return session;
    return { ...session, presenting };
  }
}
