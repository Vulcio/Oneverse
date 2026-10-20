// Templates' parts (issue #281): content themes, background themes and effects saved on their own, a person's or a
// team's; a template combines them (built-in or saved) with its tags and layout; a part changed changes every template
// using it; one in use isn't deleted; a template made before parts is split into parts of its own and looks the same;
// a screen's effects switch; a screen showing the chart before templates keeps it until it's given a template.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Parts admin");
const member = await user("Parts member");
const stranger = await user("Parts stranger");
const team = await api(admin, "POST", "/teams", { name: `Parts team ${stamp}` });
const link = await api(admin, "POST", `/teams/${team.id}/invite-links`, { role: "MEMBER" });
await api(member, "POST", `/teams/join/${link.token}`);

// --- parts
let r = await call(admin, "POST", "/screen-parts", { kind: "content", name: `Big words ${stamp}`, teamId: team.id, document: { text: { font: "display", upperCase: true }, motion: { reveal: "words" } } });
check("a team's content theme", r.status === 201 && r.body.kind === "content" && r.body.document.text.font === "display" && r.body.canEdit, JSON.stringify(r.body));
const content = r.body;
r = await call(admin, "POST", "/screen-parts", { kind: "background", name: `Waves ${stamp}`, teamId: team.id, document: { background: { kind: "waves", colors: ["#1e1b4b", "#f97316"] }, reacts: { hue: 0.9 } } });
check("a team's background theme, with how much it reacts", r.status === 201 && r.body.document.reacts.hue === 0.9, JSON.stringify(r.body));
const background = r.body;
r = await call(admin, "POST", "/screen-parts", { kind: "effects", name: `Pulse ${stamp}`, teamId: team.id, document: { reactions: [{ on: "slide", target: "pulse", amount: 0.8 }], text: { animation: "breathe" } } });
check("team effects", r.status === 201 && r.body.document.reactions.length === 1, JSON.stringify(r.body));
const effects = r.body;
r = await call(admin, "POST", "/screen-parts", { kind: "effects", name: "Bad", document: { text: { font: "sans" } } });
check("…a document of another kind is refused", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "POST", "/screen-parts", { kind: "effects", name: "Bad", document: { reactions: [{ on: "beat", target: "pulse" }] } });
check("…a trigger no client knows is refused", r.status === 400, JSON.stringify(r.body));
r = await call(member, "POST", "/screen-parts", { kind: "content", name: "Mine", teamId: team.id, document: {} });
check("…only a team's admins add its parts", r.status === 403, JSON.stringify(r.body));
r = await call(member, "GET", "/screen-parts?kind=background");
check("a member sees the team's background themes, not to change", r.status === 200 && r.body.some((one) => one.id === background.id && !one.canEdit) && r.body.every((one) => one.kind === "background"), JSON.stringify(r.body));
r = await call(stranger, "PATCH", `/screen-parts/${content.id}`, { name: "Mine now" });
check("…someone else can't change it", r.status === 404, JSON.stringify(r.body));
{
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("GIF89a")], { type: "image/gif" }), "a.gif");
  const res = await fetch(`${API}/screen-parts/${effects.id}/assets?kind=media`, { method: "POST", headers: { Authorization: `Bearer ${admin.bearer}` }, body: form });
  r = { status: res.status, body: await res.json().catch(() => null) };
}
check("…effects take no files", r.status === 400, JSON.stringify(r.body));

// --- templates
r = await call(admin, "POST", "/screen-themes", {
  name: `Night ${stamp}`,
  teamId: team.id,
  template: { tags: ["audience", "lyrics"], grid: { widgets: [{ id: "c", kind: "clock", x: 9, y: 0, w: 3, h: 1 }] } },
  content: { id: content.id },
  background: { id: background.id },
  effects: { id: effects.id },
});
check(
  "a template of the team's parts: composed, tagged",
  r.status === 201 && r.body.theme.text.font === "display" && r.body.theme.background.kind === "waves" && r.body.theme.effects.reactions[0].amount === 0.8 && r.body.template.tags.join() === "audience,lyrics" && r.body.parts.content.id === content.id,
  JSON.stringify(r.body),
);
const night = r.body;
r = await call(admin, "POST", "/screen-themes", { name: `Built in ${stamp}`, content: { builtIn: "chart" }, background: { builtIn: "concert" }, effects: { builtIn: "concert" }, template: { tags: ["stage", "chords"] } });
check("a template of built-in parts: the chart over the concert's lights", r.status === 201 && r.body.theme.shows === "chart" && r.body.theme.background.kind === "aurora" && r.body.parts.effects.builtIn === "concert", JSON.stringify(r.body));
const personal = r.body;
r = await call(admin, "POST", "/screen-themes", { name: "Bad", content: { builtIn: "comic-sans" } });
check("…a built-in part that doesn't exist is refused", r.status === 400, JSON.stringify(r.body));
const own = await api(stranger, "POST", "/screen-parts", { kind: "content", name: `Theirs ${stamp}`, document: {} });
r = await call(admin, "POST", "/screen-themes", { name: "Bad", content: { id: own.id } });
check("…someone else's part is refused", r.status === 404, JSON.stringify(r.body));
r = await call(admin, "POST", "/screen-themes", { name: "Bad", teamId: team.id, content: { id: personal.id } });
check("…a template's id isn't a part", r.status === 404, JSON.stringify(r.body));
r = await call(admin, "POST", "/screen-themes", { name: "Bad", template: { tags: ["hologram"] } });
check("…a tag no client knows is refused", r.status === 400, JSON.stringify(r.body));

// A part changed: every template using it.
await api(admin, "PATCH", `/screen-parts/${content.id}`, { document: { text: { font: "serif" } } });
r = await call(member, "GET", "/screen-themes");
check("a content theme changed: the template using it changes", r.body.find((one) => one.id === night.id)?.theme.text.font === "serif", JSON.stringify(r.body.find((one) => one.id === night.id)?.theme.text));
r = await call(admin, "GET", "/screen-parts?kind=content");
check("…and it says how many templates use it", r.body.find((one) => one.id === content.id)?.templates === 1, JSON.stringify(r.body));
r = await call(admin, "DELETE", `/screen-parts/${content.id}`);
check("a part a template uses isn't deleted", r.status === 409, JSON.stringify(r.body));
r = await call(admin, "PATCH", `/screen-themes/${night.id}`, { content: { builtIn: "classic" }, effects: null });
check("the template given the built-in words and no effects", r.status === 200 && r.body.theme.text.font === "sans" && r.body.theme.effects === null && r.body.parts.effects === null, JSON.stringify(r.body));
r = await call(admin, "DELETE", `/screen-parts/${content.id}`);
check("…then the part is deleted", r.status === 204, JSON.stringify(r.body));

// --- a template made before parts: split, looking the same
r = await call(admin, "POST", "/screen-themes", { name: `Whole ${stamp}`, theme: { text: { font: "rounded" }, background: { kind: "aurora", colors: ["#000000", "#6d28d9"], reactive: true } } });
check(
  "a whole look given: split into parts of its own, the same look",
  r.status === 201 && r.body.theme.text.font === "rounded" && r.body.theme.background.reactive === true && !!r.body.parts.content.id && !!r.body.parts.effects?.id,
  JSON.stringify(r.body),
);
const legacy = await api(admin, "POST", "/screen-themes", { name: `Kept ${stamp}`, template: {} });
sql(`update "ScreenTheme" set document = '{"text":{"font":"elegant"},"grid":{"widgets":[{"id":"s","kind":"stage","x":0,"y":0,"w":12,"h":12}]}}', "contentBuiltIn" = null, "backgroundBuiltIn" = null where id = '${legacy.id}'`);
r = await call(admin, "GET", "/screen-themes");
const kept = r.body.find((one) => one.id === legacy.id);
check("a template saved before parts, listed: split, the same look", kept?.theme.text.font === "elegant" && kept.template.grid?.widgets.length === 1 && kept.parts.content.name === `Kept ${stamp}`, JSON.stringify(kept));
check("…its parts listed with the user's", (await api(admin, "GET", "/screen-parts?kind=content")).some((one) => one.name === `Kept ${stamp}`));

// --- screens: the template's look, effects on or off
const { code } = await (await fetch(`${API}/screens/pairings`, { method: "POST", headers: { "Content-Type": "application/json" } })).json();
const pairing = await call(admin, "POST", `/screens/pairings/${code}/confirm`, { name: `Effects ${stamp}`, setMode: "DAY", themeId: night.id });
check("a screen paired without saying what it shows", pairing.status === 201 && pairing.body.mode === "LYRICS", JSON.stringify(pairing.body));
r = await call(admin, "PATCH", `/screens/${pairing.body.id}`, { effects: false });
check("its effects turned off", r.status === 200 && r.body.effects === false, JSON.stringify(r.body));
// A screen paired to show the chart, before: picking a template, it shows what that one shows.
sql(`update "Screen" set mode = 'CHART' where id = '${pairing.body.id}'`);
r = await call(admin, "PATCH", `/screens/${pairing.body.id}`, { themeTemplate: "classic" });
check("a screen showing the chart, given a template: what the template shows", r.body.mode === "LYRICS" && r.body.themeTemplate === "classic", JSON.stringify(r.body));
r = await call(admin, "PATCH", `/screens/${pairing.body.id}`, { themeTemplate: "band-chart" });
check("…the built-in chord chart template", r.status === 200 && r.body.themeTemplate === "band-chart", JSON.stringify(r.body));
await api(admin, "DELETE", `/screens/${pairing.body.id}`);
finish();
