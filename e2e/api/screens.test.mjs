// Screens (issue #186): a screen asks for a code with no sign-in; only
// someone who leads the set confirms it; the screen claims its token once,
// reads its set (as its pairer would, with the songs' credits), joins the
// set's sync session as a read-only member, follows what's presented, and is
// told at once when it's renamed, moved or disconnected.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const leader = await user("Screen leader");
const member = await user("Screen member");
const stranger = await user("Screen stranger");
const team = await api(leader, "POST", "/teams", { name: `Screen band ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tmscr${stamp}', '${team.id}', '${member.id}', 'MEMBER', now())`);
const set = await api(leader, "POST", "/setlists", { name: `Screen set ${stamp}`, teamId: team.id });
const other = await api(leader, "POST", "/setlists", { name: `Other set ${stamp}` });
const song = await api(leader, "POST", "/song-versions", {
  title: `Projected ${stamp}`,
  language: "en",
  artists: ["Band"],
  teamId: team.id,
  content: "{start_of_verse}\n[G]Amazing grace\nhow [C]sweet the sound\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
  ccli: "22025",
});
const [item] = (await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id })).items;

async function anonymous(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// --- pairing
let r = await anonymous("POST", "/screens/pairings");
check("a screen gets a code without signing in", r.status === 201 && /^[A-Z2-9]{6}$/.test(r.body.code) && r.body.secret && r.body.pairingId, JSON.stringify(r.body));
const pairing = r.body;
// As the screen app asks: no body and no Content-Type, which Express 5 leaves undefined (issue #420).
const bare = await fetch(`${API}/screens/pairings`, { method: "POST" });
check("the same with no body at all, as the screen app asks", bare.status === 201 && /^[A-Z2-9]{6}$/.test((await bare.json()).code), String(bare.status));
r = await anonymous("POST", `/screens/pairings/${pairing.pairingId}/claim`, { secret: pairing.secret });
check("claiming before it's confirmed: wait", r.status === 202 && r.body.pending === true, JSON.stringify(r));
r = await anonymous("POST", `/screens/pairings/${pairing.pairingId}/claim`, { secret: "x".repeat(32) });
check("not with another secret", r.status === 403, String(r.status));
const typed = `${pairing.code.slice(0, 3).toLowerCase()} ${pairing.code.slice(3)}`;
r = await call(leader, "GET", `/screens/pairings/${encodeURIComponent(typed)}`);
check("the code, as typed (lower case, a space), is waiting", r.status === 200 && r.body.code === pairing.code, JSON.stringify(r.body));
r = await call(member, "POST", `/screens/pairings/${pairing.code}/confirm`, { name: "Church TV", mode: "LYRICS", setlistId: set.id });
check("a member who can't lead the set can't show it", r.status === 403, String(r.status));
r = await call(stranger, "POST", `/screens/pairings/${pairing.code}/confirm`, { name: "Church TV", mode: "LYRICS", setlistId: set.id });
check("nor can a stranger", r.status === 403, String(r.status));
r = await call(leader, "POST", `/screens/pairings/${pairing.code}/confirm`, { name: "Church TV", mode: "LYRICS", setlistId: set.id });
check("its leader confirms: the screen, on the set", r.status === 201 && r.body.name === "Church TV" && r.body.setlistId === set.id && r.body.setlist?.name === `Screen set ${stamp}`, JSON.stringify(r.body));
const screenId = r.body.id;
r = await call(leader, "POST", `/screens/pairings/${pairing.code}/confirm`, { name: "Again", mode: "LYRICS", setlistId: set.id });
check("a code is confirmed once", r.status === 404, String(r.status));
r = await anonymous("POST", `/screens/pairings/${pairing.pairingId}/claim`, { secret: pairing.secret });
check("the screen claims its token", r.status === 201 && r.body.token?.startsWith("scr_") && r.body.screen?.id === screenId, JSON.stringify(r.body));
const token = r.body.token;
r = await anonymous("POST", `/screens/pairings/${pairing.pairingId}/claim`, { secret: pairing.secret });
check("once", r.status === 410, String(r.status));
check("only a hash of the token is kept", sql(`select count(*) from "Screen" where "tokenHash" = '${token}'`) === "0");

// --- what it reads
r = await anonymous("GET", "/screens/current", null, { Authorization: `Screen ${token}` });
check(
  "its set, its songs with their charts, and their credits",
  r.status === 200 && r.body.screen.mode === "LYRICS" && r.body.set?.songs?.[0]?.song?.document?.sections?.length === 1 && r.body.set.credits?.[song.id]?.ccli === "22025",
  JSON.stringify(r.body?.set?.credits),
);
r = await anonymous("GET", "/screens/current", null, { Authorization: "Screen scr_nope" });
check("not with a made-up token", r.status === 404, String(r.status));
r = await anonymous("GET", `/setlists/${set.id}`, null, { Authorization: `Bearer ${token}` });
check("the token opens nothing else", r.status === 401, String(r.status));

// --- in the set's sync session
async function device(hello) {
  const ws = new WebSocket(`${API.replace(/^http/, "ws")}/sync`);
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
  send(hello);
  const closed = new Promise((resolve) => (ws.onclose = (event) => resolve(event.code)));
  return { ws, next, send, closed, close: () => ws.close() };
}

const tv = await device({ type: "screen", token });
const told = await tv.next((m) => m.type === "screen");
check("the screen signs in by its token, and is told what it is", told?.screen?.name === "Church TV" && told.screen.setId === set.id, JSON.stringify(told));
const lead = await device({ type: "hello", token: leader.bearer });
await lead.next((m) => m.type === "ready");
lead.send({ type: "join", setId: set.id });
const seen = await lead.next((m) => m.type === "session" && m.members.some((x) => x.screen));
check("the leader sees it among the set's members, as a screen", seen?.members.find((x) => x.screen)?.name === "Church TV", JSON.stringify(seen?.members));
lead.send({ type: "lead" });
await lead.next((m) => m.type === "session" && m.leading);
lead.send({ type: "update", itemId: item.id, presenting: { itemId: item.id, slide: 1, black: false } });
const shown = await tv.next((m) => m.type === "session" && m.session?.presenting?.slide === 1);
check("the screen follows what's presented", shown?.session.presenting.itemId === item.id && shown.session.presenting.black === false, JSON.stringify(shown?.session));
lead.send({ type: "update", presenting: { itemId: item.id, slide: -1, black: false } });
check("a slide that can't be is refused", (await lead.next((m) => m.type === "error"))?.code === "bad-request");
tv.send({ type: "lead" });
check("a screen never leads", (await tv.next((m) => m.type === "error"))?.code === "forbidden");

// --- changed from the phone: told at once
r = await call(leader, "PATCH", `/screens/${screenId}`, { name: "Stage left", mode: "CHART" });
const renamed = await tv.next((m) => m.type === "screen" && m.screen.name === "Stage left");
check("renamed, in chart mode: the screen's told", renamed?.screen.mode === "CHART", JSON.stringify(renamed));
r = await call(stranger, "PATCH", `/screens/${screenId}`, { name: "Mine now" });
check("a stranger can't change it", r.status === 404, String(r.status));
r = await call(leader, "PATCH", `/screens/${screenId}`, { setlistId: other.id });
const moved = await tv.next((m) => m.type === "screen" && m.screen.setId === other.id);
check("moved to another set", !!moved, JSON.stringify(moved));
const list = await api(leader, "GET", `/screens?setlistId=${other.id}`);
check("listed with the set it shows", list.length === 1 && list[0].id === screenId, JSON.stringify(list));
r = await call(member, "GET", `/screens?setlistId=${set.id}`);
check("a set's screens are for who leads it", r.status === 403, String(r.status));
r = await call(leader, "DELETE", `/screens/${screenId}`);
const gone = await tv.next((m) => m.type === "error" && m.code === "disconnected");
check("disconnected: the screen's told, and dropped", r.status === 204 && !!gone && (await tv.closed) === 4003, JSON.stringify(gone));
r = await anonymous("GET", "/screens/current", null, { Authorization: `Screen ${token}` });
check("its token no longer works", r.status === 404, String(r.status));
lead.close();
finish();
