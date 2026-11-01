// Backups for people (issue #351): an archive of everything someone owns -
// or a team's, or an organisation's, for their admins - made by the Worker
// on demand or weekly, downloaded by a signed link, and imported back: new
// IDs, nothing already there changed, the same used as it is (importing
// twice adds nothing), and nothing taken on the archive's word - not a file
// it only names, not a song it can't show.
import { Zip, ZipDeflate, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Archives admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const owner = await user("Archives owner");
const other = await user("Archives other");
const member = await user("Archives member");

const fileBytes = Buffer.from(`Chord sheet ${stamp}\n`.repeat(200));
const fileSha = createHash("sha256").update(fileBytes).digest("hex");
async function upload(who, songId) {
  const form = new FormData();
  form.append("type", "TEXT");
  form.append("file", new Blob([fileBytes], { type: "text/plain" }), "sheet.txt");
  const res = await fetch(`${API}/song-versions/${songId}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${who.bearer}` }, body: form });
  return res.json();
}
async function waitFor(who, archive) {
  for (let i = 0; i < 120; i++) {
    const now = await api(who, "GET", `/archives/${archive.id}`);
    if (now.status === "DONE" || now.status === "FAILED") return now;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`archive ${archive.id} never finished`);
}
async function download(path) {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, type: res.headers.get("content-type"), disposition: res.headers.get("content-disposition"), bytes: Buffer.from(await res.arrayBuffer()) };
}
async function importZip(who, scope, bytes, id) {
  const form = new FormData();
  form.append("scope", scope);
  if (id) form.append("id", id);
  form.append("file", new Blob([bytes], { type: "application/zip" }), "archive.zip");
  const res = await fetch(`${API}/archives/import`, { method: "POST", headers: { Authorization: `Bearer ${who.bearer}` }, body: form });
  const body = await res.json();
  return res.ok ? waitFor(who, body) : { status: res.status, body };
}
const count = (table, where) => Number(sql(`select count(*) from "${table}" where ${where}`));
/** A zip of `files` (name -> string or bytes), as anyone could make. */
function zip(files) {
  return new Promise((resolve, reject) => {
    const parts = [];
    const writer = new Zip((error, chunk, final) => {
      if (error) return reject(error);
      parts.push(chunk);
      if (final) resolve(Buffer.concat(parts));
    });
    for (const [name, value] of Object.entries(files)) {
      const entry = new ZipDeflate(name);
      writer.add(entry);
      entry.push(typeof value === "string" ? new TextEncoder().encode(value) : value, true);
    }
    writer.end();
  });
}

// What the owner has: a song with a chart, a file, an arrangement, a songbook, a set and a note to themself.
const title = `Archived hymn ${stamp}`;
const song = await api(owner, "POST", "/song-versions", { title, language: "en", artists: ["Archive Artist"] });
await call(owner, "PATCH", `/song-versions/${song.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]Amazing [C]grace\n{end_of_verse}\n" });
const attachment = await upload(owner, song.id);
check("(the song has a file)", !!attachment.id, JSON.stringify(attachment).slice(0, 200));
const arrangement = (await call(owner, "POST", `/song-versions/${song.id}/arrangements`, { name: "Acoustic" })).body;
const book = (await call(owner, "POST", "/songbooks", { name: `Archive book ${stamp}`, kind: "SIMPLE", language: "en" })).body;
await call(owner, "POST", `/songbooks/${book.id}/entries`, { songVersionId: song.id });
const set = (await call(owner, "POST", "/setlists", { name: `Archive set ${stamp}` })).body;
await call(owner, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
await call(owner, "POST", `/setlists/${set.id}/items`, { text: { title: "Welcome", body: "Good morning" } });
await call(owner, "POST", "/notes", { songVersionId: song.id, content: "Breathe before the chorus", place: "ME" });
// Someone else's song, private: never in the owner's archive.
const secret = await api(other, "POST", "/song-versions", { title: `Not yours ${stamp}`, language: "en", artists: ["X"] });

// Made on demand.
let r = await call(owner, "POST", "/archives", { scope: "user" });
check("an archive is asked for", r.status === 201 && r.body.status === "PENDING", JSON.stringify(r.body));
const again = await call(owner, "POST", "/archives", { scope: "user" });
check("asked again while it's being made: the same one", again.body.id === r.body.id || again.body.status === "DONE", JSON.stringify(again.body));
const made = await waitFor(owner, r.body);
check("the Worker makes it", made.status === "DONE", JSON.stringify(made));
check("what it holds", made.summary.songs === 1 && made.summary.arrangements === 1 && made.summary.songbooks === 1 && made.summary.sets === 1 && made.summary.notes === 1 && made.summary.files === 1, JSON.stringify(made.summary));
check("it can be downloaded for two weeks", !!made.downloadPath && new Date(made.expiresAt).getTime() - Date.now() > 13 * 86400_000, JSON.stringify(made));

const got = await download(made.downloadPath);
check("downloaded without a token, by its signed link, as a download", got.status === 200 && /attachment/.test(got.disposition ?? "") && /\.zip/.test(got.disposition ?? ""), `${got.status} ${got.disposition}`);
const entries = unzipSync(new Uint8Array(got.bytes));
const read = (name) => JSON.parse(Buffer.from(entries[name]).toString("utf8"));
const manifest = read("manifest.json");
check("a Oneverse archive, format 1, of the owner", manifest.format === "oneverse-archive" && manifest.version === 1 && manifest.scope.kind === "USER" && manifest.scope.id === owner.id, JSON.stringify(manifest));
const songs = read("songs.json");
check("the song, its credits and its file", songs.length === 1 && songs[0].title === title && songs[0].credits.some((credit) => credit.source === "Archive Artist") && songs[0].attachments[0].sha256 === fileSha, JSON.stringify(songs).slice(0, 300));
check("the file's bytes, by their hash", Buffer.from(entries[`files/${fileSha}`] ?? []).equals(fileBytes));
check("each song as ChordPro too", Object.keys(entries).some((name) => name.startsWith("chordpro/") && Buffer.from(entries[name]).toString().includes("[G]Amazing")));
check("nobody else's song", !JSON.stringify(songs).includes(secret.id));
check("the set, its text item too", read("sets.json")[0].items.length === 2 && read("sets.json")[0].items[1].text.title === "Welcome");

const tampered = made.downloadPath.replace(/signature=[^&]+/, "signature=forged");
check("a link that isn't signed is refused", (await download(tampered)).status === 403);
check("someone else can't see it", (await call(other, "GET", `/archives/${made.id}`)).status === 404);
check("nor list the owner's", JSON.stringify((await api(other, "GET", "/archives?scope=user")).archives).includes(made.id) === false);

// Imported by someone else: theirs, with new IDs.
const before = { songs: count("SongVersion", `"ownerUserId"='${other.id}'`) };
const imported = await importZip(other, "user", got.bytes);
check("imported", imported.status === "DONE", JSON.stringify(imported));
check("what it brought in", imported.summary.created.songs === 1 && imported.summary.created.songbooks === 1 && imported.summary.created.sets === 1 && imported.summary.created.arrangements === 1 && imported.summary.created.notes === 1 && imported.summary.created.files === 1, JSON.stringify(imported.summary));
const theirs = sql(`select id from "SongVersion" where "ownerUserId"='${other.id}' and title='${title}'`);
check("a song of their own, with a new ID", !!theirs && theirs !== song.id && count("SongVersion", `"ownerUserId"='${other.id}'`) === before.songs + 1);
check("its file, the same bytes", count("Attachment", `"songVersionId"='${theirs}' and "storageKey"='${fileSha}' and "uploadedByUserId"='${other.id}'`) === 1);
check("its chart", (await api(other, "GET", `/song-versions/${theirs}`)).lyricsText?.includes("Amazing") ?? JSON.stringify(await api(other, "GET", `/song-versions/${theirs}`)).includes("Amazing"));
check("in their songbook and their set", count("SongbookEntry", `"songVersionId"='${theirs}'`) === 1 && count("SetlistItem", `"songVersionId"='${theirs}'`) === 1);
check("the note is theirs now", count("Note", `"songVersionId"='${theirs}' and "authorUserId"='${other.id}' and place='ME'`) === 1);
check("the uploaded archive isn't kept", sql(`select coalesce("storageKey", 'none') from "ContentArchive" where id='${imported.id}'`) === "none");
check("the owner's things are untouched", count("SongVersion", `id='${song.id}' and "ownerUserId"='${owner.id}'`) === 1 && count("Note", `"songVersionId"='${song.id}'`) === 1);

const twice = await importZip(other, "user", got.bytes);
check("imported twice: nothing new, what's there kept as it is", twice.status === "DONE" && twice.summary.created.songs === 0 && twice.summary.kept.songs === 1 && twice.summary.kept.songbooks === 1 && twice.summary.kept.sets === 1 && twice.summary.created.notes === 0, JSON.stringify(twice.summary));
check("(still one of each)", count("SongVersion", `"ownerUserId"='${other.id}' and title='${title}'`) === 1 && count("Songbook", `"ownerUserId"='${other.id}'`) === 1);

const updatedAt = sql(`select "updatedAt" from "SongVersion" where id='${song.id}'`);
const back = await importZip(owner, "user", got.bytes);
check("back into the owner's own: all already there, nothing changed", back.status === "DONE" && back.summary.kept.songs === 1 && back.summary.created.songs === 0 && sql(`select "updatedAt" from "SongVersion" where id='${song.id}'`) === updatedAt, JSON.stringify(back.summary));

// An archive anyone could have made: names a file it doesn't hold, and a song it can't show.
const forged = await zip({
  "manifest.json": JSON.stringify({ format: "oneverse-archive", version: 1, createdAt: new Date().toISOString(), scope: { kind: "USER", id: "x", name: "Forger" } }),
  "songs.json": JSON.stringify([{ id: "s1", title: `Forged ${stamp}`, language: "en", documentJson: songs[0].documentJson, attachments: [{ ...songs[0].attachments[0], id: "a1" }] }]),
  "sets.json": JSON.stringify([{ id: "set1", name: `Forged set ${stamp}`, items: [{ id: "i1", kind: "SONG", songId: secret.id, songTitle: "Not yours", position: 0 }] }]),
});
const stranger = await user("Archives stranger");
const fake = await importZip(stranger, "user", forged);
check("a forged archive comes in as far as it can", fake.status === "DONE" && fake.summary.created.songs === 1, JSON.stringify(fake));
check("a file it only names isn't made someone's", count("Attachment", `"uploadedByUserId"='${stranger.id}'`) === 0 && fake.summary.leftOut.some((line) => line.includes("sheet.txt")), JSON.stringify(fake.summary));
check("nor a song they can't see put in their set", count("SetlistItem", `"songVersionId"='${secret.id}'`) === 0 && fake.summary.leftOut.some((line) => line.includes("Not yours")), JSON.stringify(fake.summary));
const notZip = await importZip(stranger, "user", Buffer.from("not a zip at all"));
check("what isn't an archive fails, saying why", notZip.status === "FAILED" && /zip|archive/i.test(notZip.error ?? ""), JSON.stringify(notZip));
const newer = await importZip(stranger, "user", await zip({ "manifest.json": JSON.stringify({ format: "oneverse-archive", version: 99, createdAt: "", scope: { kind: "USER", id: "x", name: "Later" } }) }));
check("one from a newer Oneverse is refused", newer.status === "FAILED" && /newer/.test(newer.error ?? ""), JSON.stringify(newer));

// A team's: its admins'.
const team = await api(owner, "POST", "/teams", { name: `Archive band ${stamp}` });
const link = await api(owner, "POST", `/teams/${team.id}/invite-links`, {});
await call(member, "POST", `/teams/join/${link.token}`);
const teamSong = await api(owner, "POST", "/song-versions", { title: `Team hymn ${stamp}`, language: "en", artists: ["Band"], teamId: team.id });
const teamSet = (await call(owner, "POST", "/setlists", { name: `Team set ${stamp}`, teamId: team.id })).body;
await call(owner, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: teamSong.id });
check("a member can't", (await call(member, "POST", "/archives", { scope: "team", id: team.id })).status === 403);
check("nor list them", (await call(member, "GET", `/archives?scope=team&id=${team.id}`)).status === 403);
check("a team needs its id", (await call(owner, "POST", "/archives", { scope: "team" })).status === 400);
const teamArchive = await waitFor(owner, (await call(owner, "POST", "/archives", { scope: "team", id: team.id })).body);
check("the team's archive: its songs and sets, not its admin's own", teamArchive.status === "DONE" && teamArchive.summary.songs === 1 && teamArchive.summary.sets === 1, JSON.stringify(teamArchive.summary));
const team2 = await api(other, "POST", "/teams", { name: `Archive band two ${stamp}` });
const teamBytes = (await download(teamArchive.downloadPath)).bytes;
check("imported into a team its admin isn't admin of: refused", (await importZip(other, "team", teamBytes, team.id)).status === 403);
const intoTeam = await importZip(other, "team", teamBytes, team2.id);
check("into another team: the team's", intoTeam.status === "DONE" && count("SongVersion", `"ownerTeamId"='${team2.id}'`) === 1 && count("Setlist", `"ownerTeamId"='${team2.id}'`) === 1, JSON.stringify(intoTeam));

// An organisation's: its teams', team by team; imported into another, a team found by name, or made.
const org = `arc${stamp}`;
const org2 = `arc2${stamp}`;
sql(`insert into "Organization" (id, name, slug, "createdAt", "updatedAt") values ('${org}', 'Archive org ${stamp}', 'archive-org-${stamp}', now(), now()), ('${org2}', 'Archive org two ${stamp}', 'archive-org-two-${stamp}', now(), now())`);
sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('arcm1${stamp}', '${org}', '${owner.id}', 'ADMIN', now(), now()), ('arcm2${stamp}', '${org}', '${member.id}', 'MEMBER', now(), now()), ('arcm3${stamp}', '${org2}', '${other.id}', 'ADMIN', now(), now())`);
sql(`update "Team" set "organizationId" = '${org}' where id = '${team.id}'`);
check("an organisation's member can't", (await call(member, "POST", "/archives", { scope: "organization", id: org })).status === 403);
const orgArchive = await waitFor(owner, (await call(owner, "POST", "/archives", { scope: "organization", id: org })).body);
check("the organisation's archive: its teams'", orgArchive.status === "DONE" && orgArchive.summary.songs === 1, JSON.stringify(orgArchive));
const orgEntries = unzipSync(new Uint8Array((await download(orgArchive.downloadPath)).bytes));
check("(its teams named in it)", JSON.parse(Buffer.from(orgEntries["manifest.json"]).toString()).teams.some((one) => one.id === team.id));
const intoOrg = await importZip(other, "organization", (await download(orgArchive.downloadPath)).bytes, org2);
const made2 = sql(`select id from "Team" where "organizationId"='${org2}' and name='Archive band ${stamp}'`);
check("into another organisation: its team made there, its admin the importer", intoOrg.status === "DONE" && intoOrg.summary.created.teams === 1 && !!made2 && count("TeamMembership", `"teamId"='${made2}' and "userId"='${other.id}' and role='ADMIN'`) === 1 && count("SongVersion", `"ownerTeamId"='${made2}'`) === 1, JSON.stringify(intoOrg));
const intoOrgAgain = await importZip(other, "organization", (await download(orgArchive.downloadPath)).bytes, org2);
check("again: the team found by its name, nothing new", intoOrgAgain.status === "DONE" && intoOrgAgain.summary.created.teams === 0 && intoOrgAgain.summary.kept.songs === 1, JSON.stringify(intoOrgAgain.summary));

// Weekly.
check("weekly, turned on", (await api(owner, "PUT", "/archives/schedule", { scope: "user", weekly: true })).weekly === true && (await api(owner, "GET", "/archives?scope=user")).weekly === true);
await api(admin, "POST", "/admin/jobs/run/archive-tick");
let weekly;
for (let i = 0; i < 60 && !weekly; i++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  weekly = (await api(owner, "GET", "/archives?scope=user")).archives.find((archive) => archive.trigger === "WEEKLY" && archive.status === "DONE");
}
check("the hourly tick makes the week's", !!weekly, JSON.stringify((await api(owner, "GET", "/archives?scope=user")).archives.map((a) => [a.trigger, a.status])));
await api(admin, "POST", "/admin/jobs/run/archive-tick");
await new Promise((resolve) => setTimeout(resolve, 1500));
check("and not again the same week", (await api(owner, "GET", "/archives?scope=user")).archives.filter((archive) => archive.trigger === "WEEKLY").length === 1);
await api(owner, "PUT", "/archives/schedule", { scope: "user", weekly: false });
check("weekly, turned off", (await api(owner, "GET", "/archives?scope=user")).weekly === false);

// Past its time, its file's gone; deleted, the archive too.
sql(`update "ContentArchive" set "expiresAt" = now() - interval '1 minute' where id='${made.id}'`);
await api(admin, "POST", "/admin/jobs/run/archive-tick");
let expired;
for (let i = 0; i < 20 && !expired; i++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  expired = (await api(owner, "GET", `/archives/${made.id}`)).downloadPath === null;
}
check("past two weeks, no longer downloadable", expired && (await download(made.downloadPath)).status === 403);
check("deleted", (await call(owner, "DELETE", `/archives/${weekly.id}`)).status === 204 && (await call(owner, "GET", `/archives/${weekly.id}`)).status === 404);

finish();
