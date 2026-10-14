// Suggesting changes to a catalogue song (issue #74): anyone who sees it
// suggests a change made as the song editor would save it; a reviewer
// accepts it (saved as an edit credited to who suggested it, on top of
// what changed since) or declines it; the same part changed since stops it.
import { check, sql, giveRole, stamp, user, call, api, finish } from "../lib/harness.mjs";

const admin = await user("Sugg admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const reviewer = await user("Sugg reviewer");
giveRole(reviewer.id, "REVIEWER");
const alice = await user("Sugg alice");
const bob = await user("Sugg bob");

const chart = (line) => `{start_of_verse}\n[G]${line}\n{end_of_verse}\n{start_of_chorus}\n[C]The chorus\n{end_of_chorus}\n`;
const song = await api(admin, "POST", "/song-versions", { title: `Suggest ${stamp}`, language: "en", artists: ["Band"], key: "G", content: chart("Amazing grace") });
await api(admin, "POST", `/song-versions/${song.id}/publish`, {});
const personal = await api(alice, "POST", "/song-versions", { title: `Mine ${stamp}`, language: "en", artists: ["Me"] });

// --- suggesting
let detail = await api(alice, "GET", `/song-versions/${song.id}`);
const verseId = detail.documentJson.sections[0].id;
let r = await call(alice, "PATCH", `/song-versions/${song.id}`, { title: "Changed" });
check("a catalogue song isn't edited directly", r.status === 403, String(r.status));
r = await call(alice, "POST", `/song-versions/${song.id}/suggestions`, {
  content: chart("Amazing grace, how sweet"),
  revision: detail.documentJson.revision,
  message: "The line was cut short",
});
check("anyone who sees it suggests a change", r.status === 201 && r.body.state === "OPEN" && r.body.changes.join() === "chart" && r.body.description === "The line was cut short", JSON.stringify(r.body).slice(0, 300));
const lineFix = r.body;
check("the song isn't changed by it", (await api(bob, "GET", `/song-versions/${song.id}`)).documentJson.sections[0].lines[0].text === "Amazing grace");
r = await call(alice, "POST", `/song-versions/${song.id}/suggestions`, { title: `Suggest ${stamp}` });
check("one that changes nothing is refused", r.status === 400, String(r.status));
r = await call(alice, "POST", `/song-versions/${personal.id}/suggestions`, { title: "x" });
check("suggestions are for catalogue songs", r.status === 400, String(r.status));
r = await call(bob, "POST", `/song-versions/${song.id}/suggestions`, { key: "A", copyright: "Public domain" });
check("bob suggests other details", r.status === 201 && r.body.changes.join() === "details", JSON.stringify(r.body.changes));
const keyChange = r.body;
r = await call(bob, "POST", `/song-versions/${song.id}/suggestions`, { title: `Bob's title ${stamp}` });
const titleChange = r.body;

// --- who sees them
r = await call(alice, "GET", `/song-versions/${song.id}/suggestions`);
check("alice sees her own on the song", r.status === 200 && r.body.length === 1 && r.body[0].id === lineFix.id);
r = await call(alice, "GET", `/suggestions/${keyChange.id}`);
check("not someone else's", r.status === 404, String(r.status));
r = await call(alice, "GET", "/suggestions");
check("the queue is for reviewers", r.status === 403, String(r.status));
r = await call(reviewer, "GET", "/suggestions");
check("reviewers see the open ones", r.status === 200 && [lineFix.id, keyChange.id, titleChange.id].every((id) => r.body.some((s) => s.id === id)));
r = await call(reviewer, "GET", `/suggestions/${lineFix.id}`);
check(
  "a suggestion shows the song as it was and as it would be",
  r.status === 200 && r.body.base.chart.sections[0].lines[0].text === "Amazing grace" && r.body.proposed.chart.sections[0].lines[0].text === "Amazing grace, how sweet" && r.body.conflicts.length === 0,
  JSON.stringify(r.body).slice(0, 200),
);

// --- accepting
r = await call(alice, "POST", `/suggestions/${lineFix.id}/accept`, {});
check("only reviewers accept", r.status === 403, String(r.status));
r = await call(reviewer, "POST", `/suggestions/${keyChange.id}/accept`, { notes: "Thanks" });
check("accepted", r.status === 200 && r.body.state === "ACCEPTED" && r.body.reviewer?.id === reviewer.id && r.body.reviewNotes === "Thanks", JSON.stringify(r.body).slice(0, 200));
detail = await api(bob, "GET", `/song-versions/${song.id}`);
check("the song has it", detail.documentJson.defaults.key === "A" && detail.copyright === "Public domain");
let history = await api(bob, "GET", `/song-versions/${song.id}/history`);
check("its history credits who suggested it", history[0].author?.id === bob.id && history[0].changes.join() === "details", JSON.stringify(history[0]));
r = await call(reviewer, "POST", `/suggestions/${lineFix.id}/accept`, {});
check("a suggestion made before another was accepted still applies, on top of it", r.status === 200, JSON.stringify(r.body).slice(0, 200));
detail = await api(bob, "GET", `/song-versions/${song.id}`);
check("both are in", detail.documentJson.sections[0].lines[0].text === "Amazing grace, how sweet" && detail.documentJson.defaults.key === "A" && detail.documentJson.sections[0].id === verseId);
r = await call(reviewer, "POST", `/suggestions/${lineFix.id}/accept`, {});
check("a closed one can't be accepted again", r.status === 409, String(r.status));

// --- the same part changed since
await api(admin, "PATCH", `/song-versions/${song.id}`, { title: `Admin's title ${stamp}` });
r = await call(reviewer, "GET", `/suggestions/${titleChange.id}`);
check("a suggestion shows what changed since in the same place", r.body.conflicts.join() === "details.title", JSON.stringify(r.body.conflicts));
r = await call(reviewer, "POST", `/suggestions/${titleChange.id}/accept`, {});
check("and can't be accepted", r.status === 409 && r.body.conflicts?.join() === "details.title", JSON.stringify(r.body));
check("the song keeps the admin's change", (await api(bob, "GET", `/song-versions/${song.id}`)).title === `Admin's title ${stamp}`);
r = await call(reviewer, "POST", `/suggestions/${titleChange.id}/decline`, {});
check("declining needs a note", r.status === 400, String(r.status));
r = await call(reviewer, "POST", `/suggestions/${titleChange.id}/decline`, { notes: "The title changed since" });
check("declined", r.status === 200 && r.body.state === "REJECTED");
const told = async (kind) => (await api(bob, "GET", "/users/me/notifications?limit=100")).items.filter((item) => item.kind === kind);
check("who suggested it is told it was taken, and declined, with the notes (issue #149)", (await told("SUGGESTION_ACCEPTED")).some((item) => item.data.note === "Thanks" && item.data.by === "Sugg reviewer") && (await told("SUGGESTION_DECLINED"))[0]?.data.note === "The title changed since");

// --- withdrawing, reviewing your own
r = await call(reviewer, "POST", `/song-versions/${song.id}/suggestions`, { notes: "Slow" });
const own = r.body;
r = await call(reviewer, "POST", `/suggestions/${own.id}/accept`, {});
check("reviewers don't accept their own", r.status === 403, String(r.status));
r = await call(bob, "POST", `/suggestions/${own.id}/withdraw`);
check("only who suggested it withdraws it", r.status === 404 || r.status === 403, String(r.status));
r = await call(reviewer, "POST", `/suggestions/${own.id}/withdraw`);
check("withdrawn", r.status === 200 && r.body.state === "WITHDRAWN");
r = await call(bob, "GET", "/suggestions/mine");
check("bob's, newest first", r.status === 200 && r.body.length === 2 && r.body[0].id === titleChange.id && r.body[0].state === "REJECTED");

// --- deleting the song takes its suggestions
r = await call(admin, "DELETE", `/song-versions/${song.id}`);
check("a catalogue song with suggestions can be deleted", r.status === 204, String(r.status));
check("and its suggestions go", sql(`select count(*) from "ChangeProposal" where "songVersionId"='${song.id}'`) === "0");

finish();
