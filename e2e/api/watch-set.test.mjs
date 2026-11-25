// Watching a set without joining it (issue #521): the Oneverse app's
// running order and Songverse's set page are told when it changes - only
// for someone who can open it, without showing among its session's members,
// until they stop.
import { API, api, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const owner = await user("Watch owner");
const member = await user("Watch member");
const stranger = await user("Watch stranger");
const team = await api(owner, "POST", "/teams", { name: `Watch band ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tmw${stamp}', '${team.id}', '${member.id}', 'MEMBER', now())`);
const set = await api(owner, "POST", "/setlists", { name: `Watched set ${stamp}`, teamId: team.id });

/** A device: its messages as they come, and a wait for the next one that matches. */
async function device(who) {
  const ws = new WebSocket(`${API.replace(/^http/, "ws")}/sync`);
  // Messages no wait has claimed yet: a wait takes the first that matches, already here or to come.
  const messages = [];
  const waiting = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const w = waiting.find((one) => one.match(message));
    if (w) {
      waiting.splice(waiting.indexOf(w), 1);
      w.resolve(message);
    } else messages.push(message);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const next = (match, ms = 3000) =>
    new Promise((resolve) => {
      const early = messages.findIndex(match);
      if (early >= 0) return resolve(messages.splice(early, 1)[0]);
      const w = { match, resolve };
      waiting.push(w);
      setTimeout(() => {
        if (waiting.includes(w)) {
          waiting.splice(waiting.indexOf(w), 1);
          resolve(null);
        }
      }, ms);
    });
  const send = (message) => ws.send(JSON.stringify(message));
  if (who) {
    const ready = next((m) => m.type === "ready");
    send({ type: "hello", token: who.bearer });
    await ready;
  }
  return { ws, messages, next, send, close: () => ws.close() };
}
const error = (m) => m.type === "error";
const changed = (m) => m.type === "set-changed" && m.setId === set.id;

const outsider = await device(stranger);
outsider.send({ type: "watch-set", setId: set.id });
check("someone who can't open the set can't watch it", (await outsider.next(error))?.code === "not-found");

const watcher = await device(member);
watcher.send({ type: "watch-set", setId: set.id });
check("a member watches it", (await watcher.next((m) => m.type === "watching-set"))?.setId === set.id);

await api(owner, "POST", `/setlists/${set.id}/items`, { text: { title: `Welcome ${stamp}`, body: "Hello" } });
check("told when it changes", !!(await watcher.next(changed)));
check("not the outsider", !(await outsider.next(changed, 800)));

const player = await device(owner);
player.send({ type: "join", setId: set.id });
const joined = await player.next((m) => m.type === "session");
check("the watcher isn't among the session's members", !!joined && !joined.members.some((m) => m.id === member.id), JSON.stringify(joined?.members));

watcher.send({ type: "watch-set", setId: null });
await new Promise((resolve) => setTimeout(resolve, 200));
await api(owner, "PATCH", `/setlists/${set.id}`, { name: `Renamed ${stamp}` });
check("the session's member is told too", !!(await player.next(changed)));
check("stopped: not told any more", !(await watcher.next(changed, 800)));

for (const one of [outsider, watcher, player]) one.close();
finish();
