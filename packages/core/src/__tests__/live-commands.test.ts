import { describe, expect, it } from "vite-plus/test";
import { LiveCommands } from "../live/commands.js";
import type { SyncClientMessage, SyncSession } from "../sync/index.js";

const SESSION: SyncSession = {
  rev: 4,
  leader: { id: "u_a", name: "Ana" },
  metronome: null,
  stems: null,
  itemId: "item_1",
  presenting: { itemId: "item_1", slide: 2, black: false },
  presentingRev: 3,
};

function setup() {
  const sent: SyncClientMessage[] = [];
  let open = true;
  let n = 0;
  const commands = new LiveCommands(
    (message) => {
      if (!open) return false;
      sent.push(message);
      return true;
    },
    () => `cmd-${++n}-xxxxx`,
  );
  return { commands, sent, close: () => (open = false), reopen: () => (open = true) };
}

describe("LiveCommands", () => {
  it("sends a command with its id and epoch, and keeps it until it's answered", () => {
    const { commands, sent } = setup();
    const id = commands.submit({ kind: "present", presenting: { itemId: "item_1", slide: 3, black: false }, basedOn: 3 }, 0);
    expect(sent).toEqual([{ type: "command", id, epoch: 0, op: { kind: "present", presenting: { itemId: "item_1", slide: 3, black: false }, basedOn: 3 } }]);
    expect(commands.sending).toBe(true);
    expect(commands.receive({ type: "ack", id: "someone-elses", rev: 5 })).toBe(false);
    expect(commands.receive({ type: "ack", id, rev: 5 })).toBe(true);
    expect(commands.sending).toBe(false);
  });

  it("shows the slide asked for while it's on its way, not the session from before it", () => {
    const { commands } = setup();
    const id = commands.submit({ kind: "present", presenting: { itemId: "item_1", slide: 3, black: false }, basedOn: 3 });
    expect(commands.view(SESSION)?.presenting).toEqual({ itemId: "item_1", slide: 3, black: false });
    // Refused (someone moved the screens first): the server's again.
    commands.receive({ type: "error", id, code: "stale", message: "moved on" });
    expect(commands.view(SESSION)?.presenting).toEqual(SESSION.presenting);
  });

  it("the last of several on their way is what's shown; stopping shows nothing", () => {
    const { commands } = setup();
    commands.submit({ kind: "present", presenting: { itemId: "item_1", slide: 3, black: false }, basedOn: 3 });
    commands.submit({ kind: "present", presenting: null, basedOn: 4 });
    expect(commands.view(SESSION)?.presenting).toBeNull();
  });

  it("other commands leave what's shown as the server has it", () => {
    const { commands } = setup();
    commands.submit({ kind: "screens", control: "shared" });
    expect(commands.view(SESSION)).toBe(SESSION);
  });

  it("a command sent on a dead connection goes again, in order, once back in the set", () => {
    const { commands, sent, close, reopen } = setup();
    close();
    const first = commands.submit({ kind: "present", presenting: { itemId: "item_1", slide: 3, black: false }, basedOn: 3 });
    const second = commands.submit({ kind: "present", presenting: { itemId: "item_1", slide: 4, black: false }, basedOn: 4 });
    expect(sent).toEqual([]);
    reopen();
    commands.rejoined();
    expect(sent.map((message) => (message.type === "command" ? message.id : null))).toEqual([first, second]);
    // Applied before the drop, its ack lost: answered again, and off the list.
    commands.receive({ type: "ack", id: first, rev: 5 });
    commands.receive({ type: "ack", id: second, rev: 6 });
    expect(commands.sending).toBe(false);
  });

  it("an error without an id isn't an answer to any command", () => {
    const { commands } = setup();
    commands.submit({ kind: "end" });
    expect(commands.receive({ type: "error", code: "bad-request", message: "?" })).toBe(false);
    expect(commands.sending).toBe(true);
    commands.clear();
    expect(commands.sending).toBe(false);
  });
});
