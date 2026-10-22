import { mayPresent, SYNC_PATH, verifyLivePass, type LiveActor, type LiveCommandOp, type LiveSessionState, type SyncClientMessage, type SyncMember, type SyncServerMessage, type SyncSession } from "@oneverse/core";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { CloudLink } from "./cloud-link.js";

/**
 * Oneverse Pulse's server for the room (issue #247, docs/live-session.md):
 * the cloud's /sync, for the devices on the venue's network, run by the
 * engine. A device enters with a pass the cloud signed (`enter`), checked
 * with the cloud's key offline: it's that person, on that device, with what
 * they may do in the set, as the cloud said when it signed it. Then it joins
 * the set, hears its session, and sends commands, applied by the engine
 * while the room runs the session (refused while the cloud does: the
 * devices talk to the cloud then).
 *
 * Not yet: the stage (timers, messages), the old messages besides `present`,
 * and screens of Pulse's own.
 */

interface RoomDevice {
  id: string;
  socket: WebSocket;
  actor: LiveActor | null;
  joined: boolean;
}

const OPEN = 1;
/** A pass, an entrance: the most bytes a message may have. */
const MAX_MESSAGE = 64 * 1024;

export class Room {
  private readonly devices = new Set<RoomDevice>();
  private readonly wss: WebSocketServer;

  constructor(
    server: Server,
    private readonly link: CloudLink,
    private readonly setId: string,
    private readonly now: () => number = Date.now,
  ) {
    this.wss = new WebSocketServer({ server, path: SYNC_PATH, maxPayload: MAX_MESSAGE });
    this.wss.on("connection", (socket) => this.connected(socket));
    // What the cloud says, or the cloud taking the session back: the room hears it.
    link.onSession(() => this.broadcast());
  }

  close() {
    for (const device of this.devices) device.socket.close();
    this.wss.close();
  }

  private connected(socket: WebSocket) {
    const device: RoomDevice = { id: randomUUID(), socket, actor: null, joined: false };
    this.devices.add(device);
    socket.on("message", (data) => {
      let message: SyncClientMessage;
      try {
        message = JSON.parse(String(data)) as SyncClientMessage;
      } catch {
        return;
      }
      void this.receive(device, message);
    });
    socket.on("close", () => {
      this.devices.delete(device);
      if (device.joined) this.broadcast();
    });
  }

  private send(device: RoomDevice, message: SyncServerMessage) {
    if (device.socket.readyState === OPEN) device.socket.send(JSON.stringify(message));
  }

  private async receive(device: RoomDevice, message: SyncClientMessage) {
    if (message.type === "ping") return this.send(device, { type: "pong", id: message.id, sent: message.sent, at: this.now() });
    if (message.type === "enter") return this.enter(device, message.pass);
    const actor = device.actor;
    if (!actor) return this.send(device, { type: "error", code: "unauthorized", message: "Enter with a pass first" });
    switch (message.type) {
      case "join":
        if (message.setId !== this.setId) return this.send(device, { type: "error", code: "not-found", message: "This Pulse runs another set" });
        device.joined = true;
        return this.broadcast();
      case "leave":
        device.joined = false;
        return this.broadcast();
      case "command":
        return this.command(device, actor, message.id, message.epoch, message.op);
      case "present":
        return this.command(device, actor, `present-${randomUUID()}`, undefined, { kind: "present", presenting: message.presenting, basedOn: message.basedOn });
      default:
        return this.send(device, { type: "error", code: "bad-request", message: "Not on Pulse yet" });
    }
  }

  private async enter(device: RoomDevice, pass: unknown) {
    const key = this.link.passKey;
    const payload = typeof pass === "string" && key ? await verifyLivePass(pass, key, this.setId, this.now()) : null;
    if (!payload) return this.send(device, { type: "error", code: "unauthorized", message: "This pass isn't one for this set, or it has expired" });
    device.actor = { userId: payload.sub, name: payload.name, device: payload.device, canLead: payload.canLead, canOperate: payload.canOperate };
    this.send(device, { type: "ready", userId: payload.sub });
  }

  private command(device: RoomDevice, actor: LiveActor, id: string, epoch: number | undefined, op: LiveCommandOp) {
    if (!device.joined) return this.send(device, { type: "error", id, code: "bad-request", message: "Join the set first" });
    const before = this.link.engine.state;
    this.send(device, this.link.engine.command(actor, { id, epoch, op }));
    if (this.link.engine.state !== before) this.broadcast();
  }

  /** The session as the devices in the room know it: the cloud's shape (SyncSession), for each of them. */
  private broadcast() {
    const stored = this.link.engine.state;
    const joined = [...this.devices].filter((device) => device.joined && device.actor);
    const online = (holder: { device: string }) => joined.some((device) => device.actor!.device === holder.device);
    const members: SyncMember[] = joined.map((device) => ({ id: device.actor!.userId, name: device.actor!.name, leading: !!stored && device.actor!.device === stored.leader.device }));
    const session = stored ? toSyncSession(stored, online) : null;
    for (const device of joined) {
      const actor = device.actor!;
      this.send(device, {
        type: "session",
        setId: this.setId,
        session,
        members,
        leading: stored?.leader.device === actor.device,
        canLead: actor.canLead,
        stage: null,
        screensMine: !!stored?.screens && stored.screens.device === actor.device,
        canPresent: mayPresent(stored, actor),
        canOperate: actor.canLead || actor.canOperate,
      });
    }
  }
}

function toSyncSession(stored: LiveSessionState, online: (holder: { device: string }) => boolean): SyncSession {
  return {
    ...stored,
    leader: { id: stored.leader.id, name: stored.leader.name, online: online(stored.leader) },
    screens: stored.screens ? { id: stored.screens.id, name: stored.screens.name, exclusive: stored.screens.exclusive, ...(!online(stored.screens) && { online: false }) } : null,
  };
}
