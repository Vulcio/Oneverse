// A song shared with a whole organisation (issue #350): everyone in it views
// it, joining later too, and its teams' sets can hold it; nobody edits it
// through that share, and the organisation never owns it. Only who manages
// the song shares it, with an organisation they're in.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const owner = await user("orgshare owner");
const member = await user("orgshare member");
const admin = await user("orgshare team admin");
const outsider = await user("orgshare outsider");

const org = `oss${stamp}`;
sql(`insert into "Organization" (id, name, slug, "createdAt", "updatedAt") values ('${org}', 'Org share ${stamp}', 'org-share-${stamp}', now(), now())`);
sql(
  `insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('osm1${stamp}', '${org}', '${owner.id}', 'MEMBER', now(), now()), ('osm2${stamp}', '${org}', '${member.id}', 'MEMBER', now(), now()), ('osm3${stamp}', '${org}', '${admin.id}', 'ADMIN', now(), now())`,
);
const team = (await call(admin, "POST", "/teams", { name: `Org share team ${stamp}` })).body;
sql(`update "Team" set "organizationId" = '${org}' where id = '${team.id}'`);
const song = async (who, title) => (await call(who, "POST", "/song-versions", { artists: ["Band"], title, language: "en", content: "[G]Hello [D]world\n" })).body;

const shared = await song(owner, `Org shared ${stamp}`);
let r = await call(member, "GET", `/song-versions/${shared.id}`);
check("a personal song is its owner's alone", r.status === 403 || r.status === 404, String(r.status));
r = await call(outsider, "PUT", `/song-versions/${shared.id}/shares/organizations/${org}`);
check("only who manages a song shares it", r.status === 403, String(r.status));
const outsiderSong = await song(outsider, `Org outsider ${stamp}`);
r = await call(outsider, "PUT", `/song-versions/${outsiderSong.id}/shares/organizations/${org}`);
check("…and only with an organisation they're in", r.status === 403, String(r.status));

r = await call(owner, "PUT", `/song-versions/${shared.id}/shares/organizations/${org}`);
check("its owner shares it with their organisation", r.status === 200 && r.body.length === 1 && r.body[0].organization.id === org, JSON.stringify(r.body));
r = await call(owner, "GET", `/song-versions/${shared.id}/shares/organizations`);
check("…listed with the organisations it's shared with", r.status === 200 && r.body[0]?.organization.name === `Org share ${stamp}`);
r = await call(member, "GET", `/song-versions/${shared.id}/shares/organizations`);
check("…which only who manages it sees", r.status === 403, String(r.status));
r = await call(owner, "GET", `/song-versions/${shared.id}`);
check("its owner isn't told it's shared with them", r.body.sharedBy === null && r.body.canManage === true, JSON.stringify(r.body.sharedBy));

r = await call(member, "GET", `/song-versions/${shared.id}`);
check("everyone in the organisation opens it, told by whom and with which", r.status === 200 && r.body.sharedBy?.organization?.id === org && r.body.sharedBy.canEdit === false && r.body.canEdit === false, JSON.stringify(r.body.sharedBy));
r = await call(member, "GET", `/song-versions?q=${encodeURIComponent(`Org shared ${stamp}`)}`);
check("…and finds it in their library", r.body.items?.some((item) => item.id === shared.id && item.sharedBy?.organization?.id === org));
r = await call(member, "PATCH", `/song-versions/${shared.id}`, { title: "Nope" });
check("…to view only", r.status === 403, String(r.status));
r = await call(admin, "PATCH", `/song-versions/${shared.id}`, { title: "Nope" });
check("…even for the organisation's admins", r.status === 403, String(r.status));
r = await call(member, "DELETE", `/song-versions/${shared.id}/shares/me`);
check("an organisation's share isn't a member's to leave", r.status === 404, String(r.status));
r = await call(outsider, "GET", `/song-versions/${shared.id}`);
check("someone outside the organisation doesn't open it", r.status === 403 || r.status === 404, String(r.status));

// Joining later: in the organisation, they see it.
const late = await user("orgshare late");
check("(not yet in it)", [403, 404].includes((await call(late, "GET", `/song-versions/${shared.id}`)).status));
sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('osm4${stamp}', '${org}', '${late.id}', 'MEMBER', now(), now())`);
check("someone who joins the organisation later sees it too", (await call(late, "GET", `/song-versions/${shared.id}`)).status === 200);

// A team of the organisation: its sets take the song.
const teamSet = (await call(admin, "POST", "/setlists", { name: `Org share set ${stamp}`, teamId: team.id })).body;
r = await call(admin, "GET", `/song-versions?q=${encodeURIComponent(`Org shared ${stamp}`)}&addableTo=${teamSet.id}`);
check("a set of one of its teams lists it to add", r.body.items?.some((item) => item.id === shared.id), JSON.stringify(r.body.items?.map((item) => item.id)));
r = await call(admin, "POST", `/setlists/${teamSet.id}/items`, { songVersionId: shared.id });
check("…and takes it", r.status === 201 && r.body.items.some((item) => item.song?.id === shared.id), String(r.status));
const otherTeam = (await call(outsider, "POST", "/teams", { name: `Not the org ${stamp}` })).body;
const otherSet = (await call(outsider, "POST", "/setlists", { name: `Not the org set ${stamp}`, teamId: otherTeam.id })).body;
r = await call(outsider, "POST", `/setlists/${otherSet.id}/items`, { songVersionId: shared.id });
check("a team outside the organisation doesn't", r.status === 400 || r.status === 403 || r.status === 404, String(r.status));

// Stopping: they no longer see it.
r = await call(owner, "DELETE", `/song-versions/${shared.id}/shares/organizations/${org}`);
check("its owner stops sharing it", r.status === 200 && r.body.length === 0, JSON.stringify(r.body));
r = await call(member, "GET", `/song-versions/${shared.id}`);
check("…and the organisation no longer opens it", r.status === 403 || r.status === 404, String(r.status));
r = await call(admin, "GET", `/setlists/${teamSet.id}`);
check("…nor reads it in its team's set", r.body.items.length === 1 && r.body.items[0].song === null, JSON.stringify(r.body.items[0]).slice(0, 200));

// A team's song: its admins share it with the team's organisation.
const teamSong = (await call(admin, "POST", "/song-versions", { artists: ["Band"], title: `Org team song ${stamp}`, language: "en", content: "[G]Hi\n", teamId: team.id })).body;
r = await call(admin, "PUT", `/song-versions/${teamSong.id}/shares/organizations/${org}`);
check("a team's admin shares the team's song with its organisation", r.status === 200, String(r.status));
r = await call(owner, "GET", `/song-versions/${teamSong.id}`);
check("…and the organisation's members open it", r.status === 200 && r.body.sharedBy?.organization?.id === org, JSON.stringify(r.body.sharedBy));

sql(`delete from "Organization" where id = '${org}'`);
check("deleting the organisation stops its shares", (await call(owner, "GET", `/song-versions/${teamSong.id}`)).status !== 200);

finish();
