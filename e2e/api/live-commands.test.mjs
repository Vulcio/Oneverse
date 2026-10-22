// Commands (issue #247, docs/live-session.md): a change to a set's live
// session sent with an id the device chose, answered with `ack` and the
// session's revision, or an error carrying the id. The same command sent
// again (a resend after a drop) is acknowledged again, applied once; one
// from another epoch is refused; the server's own ops can't be sent. Each
// change applied is kept in the session's record, written by the Worker.
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

const leader = await user("Commander");
const guest = await user("Onlooker");
const set = await api(leader, "POST", "/setlists", { name: `Commands ${stamp}` });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo\n\nThree" } });
const itemId = items[0].id;
// The guest opens the set through its link: they can't edit it.
const token = (await api(leader, "POST", `/setlists/${set.id}/share-link`)).link.token;
await call(guest, "POST", `/set-invites/${token}/join`);

const devices = [];
async function joined(who) {
  const device = await syncDevice(who);
  devices.push(device);
  device.send({ type: "join", setId: set.id, deviceId: `cmd-${who.id.slice(0, 8)}-${stamp}` });
  await device.next((m) => m.type === "session");
  return device;
}
const answer = (device, id) => device.next((m) => (m.type === "ack" || m.type === "error") && m.id === id);
const sessionWhere = (device, test) => device.next((m) => m.type === "session" && test(m));

try {
  const desk = await joined(leader);
  desk.send({ type: "command", id: `lead-${stamp}`, op: { kind: "lead" } });
  let a = await answer(desk, `lead-${stamp}`);
  check("leading, as a command: acknowledged with the revision", a?.type === "ack" && a.rev === 1, JSON.stringify(a));
  const s = await sessionWhere(desk, (m) => m.leading);
  const epoch = s?.session.epoch;

  const next = { type: "command", id: `next-${stamp}`, epoch, op: { kind: "present", presenting: { itemId, slide: 1, black: false }, basedOn: 0 } };
  desk.send(next);
  a = await answer(desk, next.id);
  check("Next: acknowledged", a?.type === "ack" && a.rev === 2, JSON.stringify(a));
  desk.send(next);
  a = await answer(desk, next.id);
  check("sent again after a drop: acknowledged again, at the same revision", a?.type === "ack" && a.rev === 2, JSON.stringify(a));
  // Applied once, what's presented went up once: a Next decided from it is taken.
  desk.send({ type: "command", id: `then-${stamp}`, op: { kind: "present", presenting: { itemId, slide: 2, black: false }, basedOn: 1 } });
  a = await answer(desk, `then-${stamp}`);
  check("…and applied once: the next one, decided from it, is taken", a?.type === "ack" && a.rev === 3, JSON.stringify(a));
  desk.send({ type: "command", id: `stale-${stamp}`, op: { kind: "present", presenting: { itemId, slide: 2, black: false }, basedOn: 0 } });
  a = await answer(desk, `stale-${stamp}`);
  check("decided from what's no longer shown: refused as stale, by its id", a?.type === "error" && a.code === "stale", JSON.stringify(a));
  desk.send({ type: "command", id: `epoch-${stamp}`, epoch: epoch + 1, op: { kind: "present", presenting: null } });
  a = await answer(desk, `epoch-${stamp}`);
  check("from another epoch: refused, to load it again", a?.type === "error" && a.code === "epoch", JSON.stringify(a));
  desk.send({ type: "command", id: `leave-${stamp}`, op: { kind: "leave", dropped: true } });
  a = await answer(desk, `leave-${stamp}`);
  check("the server's own ops can't be sent", a?.type === "error" && a.code === "bad-request", JSON.stringify(a));
  desk.send({ type: "command", id: "short", op: { kind: "end" } });
  a = await desk.next((m) => m.type === "error");
  check("a command needs an id worth the name", a?.code === "bad-request" && a.id === undefined, JSON.stringify(a));

  const onlooker = await joined(guest);
  onlooker.send({ type: "command", id: `tempo-${stamp}`, op: { kind: "tempo", itemId } });
  a = await answer(onlooker, `tempo-${stamp}`);
  check("someone who may not: refused, by its id", a?.type === "error" && a.code === "forbidden", JSON.stringify(a));

  desk.send({ type: "command", id: `end-${stamp}`, op: { kind: "end" } });
  a = await answer(desk, `end-${stamp}`);
  check("ending it: acknowledged", a?.type === "ack", JSON.stringify(a));

  // The record: each change applied, once, in order, by whom and from where.
  const admin = await user("Recorder");
  sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
  const sessionId = s?.session.sessionId;
  const recorded = () => sql(`select string_agg(rev || ' ' || (op->>'kind'), ', ' order by rev) from "LiveSessionCommand" where "sessionId" = '${sessionId}'`);
  let record = "";
  for (let i = 0; i < 40 && record !== "1 lead, 2 present, 3 present, 4 end"; i++) {
    if (i % 10 === 0) await api(admin, "POST", "/admin/jobs/run/record-live-sessions");
    await new Promise((resolve) => setTimeout(resolve, 500));
    record = recorded();
  }
  check("recorded: each change applied, once, in order", record === "1 lead, 2 present, 3 present, 4 end", record);
  check(
    "…by whom, from which device, in the cloud",
    sql(`select count(*) from "LiveSessionCommand" where "sessionId" = '${sessionId}' and "userId" = '${leader.id}' and "deviceId" like 'd:${leader.id}:cmd-%' and origin = 'cloud' and epoch = ${epoch}`) === "4",
  );
} finally {
  for (const device of devices) device.close();
}

finish();
