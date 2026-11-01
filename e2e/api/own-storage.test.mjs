// An organisation's own bucket (issue #206): allowed by Admin > Organisations
// and a role, connected by the organisation's admins (tried before it's kept,
// the secret never shown again), its teams' songs' files moved in by the
// Worker and new ones written there, read from where each file is, and moved
// back out when a team leaves or the organisation stops using it. A bucket
// that stops answering gets nothing new until it does. The suites' "buckets"
// are folders under OWN_STORAGE_LOCAL_DIR.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { API, STORAGE_DIR, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const BUCKETS = process.env.OWN_STORAGE_LOCAL_DIR;
if (!BUCKETS) {
  console.log("SKIP own-storage: OWN_STORAGE_LOCAL_DIR isn't set");
  process.exit(0);
}

const admin = await user("Own storage admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const orgAdmin = await user("Own storage org admin");
const outsider = await user("Own storage outsider");

const org = `ows${stamp}`;
sql(`insert into "Organization" (id, name, slug, "createdAt", "updatedAt") values ('${org}', 'Own storage ${stamp}', 'own-storage-${stamp}', now(), now())`);
sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('owsm${stamp}', '${org}', '${orgAdmin.id}', 'ADMIN', now(), now())`);
const team = await api(orgAdmin, "POST", "/teams", { name: `Own storage team ${stamp}` });
sql(`update "Team" set "organizationId" = '${org}' where id = '${team.id}'`);
const teamSong = await api(orgAdmin, "POST", "/song-versions", { artists: ["Band"], title: `Own storage song ${stamp}`, language: "en", content: "[G]Hi\n", teamId: team.id });
const ownSong = await api(orgAdmin, "POST", "/song-versions", { artists: ["Band"], title: `Own storage mine ${stamp}`, language: "en", content: "[G]Hi\n" });

let n = 0;
async function upload(songId, size = 0, who = orgAdmin) {
  const line = `Own storage ${stamp} ${++n}\n`;
  const bytes = Buffer.from(line.repeat(Math.max(100, Math.ceil(size / line.length))));
  const form = new FormData();
  form.append("type", "TEXT");
  form.append("file", new Blob([bytes], { type: "text/plain" }), `sheet-${n}.txt`);
  const res = await fetch(`${API}/song-versions/${songId}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${who.bearer}` }, body: form });
  return { ...(await res.json()), status: res.status, bytes, sha: createHash("sha256").update(bytes).digest("hex") };
}
const bucket = `org-bucket-${stamp}`;
const inBucket = (file) => existsSync(path.join(BUCKETS, bucket, file.sha));
const onServer = (file) => existsSync(path.join(STORAGE_DIR, file.sha));
const where = (file) => sql(`select coalesce("storedInOrganizationId", '') from "Attachment" where id = '${file.id}'`);
const reads = async (file, songId = teamSong.id) => {
  const res = await fetch(`${API}/song-versions/${songId}/attachments/${file.id}/download`, { headers: { Authorization: `Bearer ${orgAdmin.bearer}` } });
  return res.status === 200 && Buffer.from(await res.arrayBuffer()).equals(file.bytes);
};
const storage = () => api(orgAdmin, "GET", `/organizations/${org}/storage`);
/** Runs the Worker's tick and waits until nothing is on the move. */
async function settle() {
  await api(admin, "POST", "/admin/jobs/run/own-storage-tick");
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const now = await storage();
    if (now.moving === 0 && now.state !== "LEAVING") return now;
  }
  return storage();
}
const connect = { provider: "S3", region: "eu-central-1", bucket, accessKeyId: `AKIA${stamp}`, secretAccessKey: `secret-${stamp}` };

// --- who may
let r = await call(outsider, "GET", `/organizations/${org}/storage`);
check("only the organisation's admins see its storage", r.status === 403, String(r.status));
r = await call(orgAdmin, "GET", `/organizations/${org}/storage`);
check("nothing connected, and not allowed until the server's admin allows it", r.status === 200 && r.body.allowed === false && r.body.configured === false, JSON.stringify(r.body));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage`, connect);
check("…so connecting one is refused", r.status === 403, String(r.status));
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
r = await call(admin, "PUT", "/admin/organizations/settings", { ownStorage: true });
check("Admin > Organisations allows organisations their own storage", r.status === 204, String(r.status));
check("…which still needs a role that allows it", (await storage()).allowed === false);
const role = await api(admin, "POST", "/admin/roles", { name: `Own storage ${stamp}`, canUseOwnStorage: true });
check("a role allows using one's own storage", (await api(admin, "GET", "/admin/roles")).find((each) => each.id === role.id)?.canUseOwnStorage === true);
await api(admin, "PUT", `/admin/users/${orgAdmin.id}/roles`, { roleIds: [role.id, "role_audio_uploads"] });
check("…and with it, they may", (await storage()).allowed === true);

// --- connecting it
const before = await upload(teamSong.id);
check("before, a team's file is on the server's storage", where(before) === "" && onServer(before));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage`, { provider: "R2", bucket, accessKeyId: "key", secretAccessKey: "secret" });
check("R2 needs its account ID", r.status === 400, JSON.stringify(r.body));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage`, { ...connect, endpoint: "https://169.254.169.254" });
check("an address can't be given: it's worked out from the provider", r.status === 400, JSON.stringify(r.body));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage`, { ...connect, secretAccessKey: undefined });
check("the first time needs the secret", r.status === 400, JSON.stringify(r.body));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage`, connect);
check(
  "its admin connects a bucket: tried, kept, the key masked and the secret never shown",
  r.status === 200 && r.body.configured && r.body.state === "ACTIVE" && r.body.bucket === bucket && r.body.accessKeyIdMasked !== connect.accessKeyId && !JSON.stringify(r.body).includes(connect.secretAccessKey),
  JSON.stringify(r.body),
);
check("…the secret encrypted where it's kept", !sql(`select "secretAccessKeyEnc" from "OrganizationStorage" where "organizationId"='${org}'`).includes(connect.secretAccessKey));
let now = await settle();
check("the team's files are moved into it", now.files === 1 && where(before) === org && inBucket(before) && !onServer(before), JSON.stringify(now));
check("…and read from there", await reads(before));

const after = await upload(teamSong.id);
check("a new file of a team's song goes straight there", where(after) === org && inBucket(after) && !onServer(after));
check("…and reads back", await reads(after));
const mine = await upload(ownSong.id);
check("someone's own song's files stay on the server's storage", where(mine) === "" && onServer(mine) && !inBucket(mine));
check("…and read from there", await reads(mine, ownSong.id));

r = await call(orgAdmin, "PUT", `/organizations/${org}/storage`, { provider: "S3", region: "eu-central-1", bucket });
check("saved again without the keys, it keeps them", r.status === 200 && r.body.accessKeyIdMasked === now.accessKeyIdMasked, JSON.stringify(r.body));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage`, { ...connect, bucket: `${bucket}-other` });
check("its bucket can't change while files are in it", r.status === 409, String(r.status));
r = await call(admin, "DELETE", `/admin/organizations/${org}`);
check("the organisation can't be deleted while it uses its own storage", r.status === 409, String(r.status));

// --- its admins' limits on what goes into it
const MB = 1024 * 1024;
r = await call(outsider, "PUT", `/organizations/${org}/storage/limits`, { maxFileMb: 1 });
check("only its admins set its limits", r.status === 403, String(r.status));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage/limits`, { maxFileMb: 501 });
check("a largest file over the server's own maximum is refused", r.status === 400, JSON.stringify(r.body));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage/limits`, { maxFileMb: 1 });
check("its admin sets the largest file", r.status === 200 && r.body.maxFileMb === 1 && r.body.teamLimitMb === null && r.body.usedBytes > 0, JSON.stringify(r.body));
let big = await upload(teamSong.id, 1.5 * MB);
check("…and a larger file of a team's song is refused", big.status === 413 && big.code === "ORGANIZATION_FILE_TOO_LARGE", JSON.stringify({ status: big.status, code: big.code }));
big = await upload(ownSong.id, 1.5 * MB);
check("…not someone's own song's, kept on the server", big.status === 201, String(big.status));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage/limits`, { maxFileMb: null, memberLimitMb: 1 });
check("a limit cleared, another set, the rest kept", r.body.maxFileMb === null && r.body.memberLimitMb === 1, JSON.stringify(r.body));
const fits = await upload(teamSong.id, 0.6 * MB);
check("a person uploads within their limit there", fits.status === 201 && where(fits) === org, String(fits.status));
big = await upload(teamSong.id, 0.6 * MB);
check("…and not past it", big.status === 413 && big.code === "STORAGE_LIMIT_EXCEEDED", JSON.stringify({ status: big.status, message: big.message }));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage/limits`, { memberLimitMb: null, teamLimitMb: 1 });
big = await upload(teamSong.id, 0.6 * MB);
check("a team can't keep more there than its limit", big.status === 413 && big.code === "TEAM_STORAGE_LIMIT_EXCEEDED", JSON.stringify({ status: big.status, message: big.message }));
r = await call(orgAdmin, "PUT", `/organizations/${org}/storage/limits`, { teamLimitMb: null });
check("with no limits, it takes it again", (await upload(teamSong.id, 0.6 * MB)).status === 201 && r.body.teamLimitMb === null);

// --- only its roles' holders keep files there: its own roles, made by its admins as Admin > Roles makes the server's
const player = await user("Own storage player");
const invite = await api(orgAdmin, "POST", `/teams/${team.id}/invite-links`, {});
await call(player, "POST", `/teams/join/${invite.token}`);
let got = await upload(teamSong.id, 0, player);
check("a team member without one of the organisation's roles keeps nothing there", got.status === 403, JSON.stringify({ status: got.status, message: got.message }));
r = await call(player, "POST", `/organizations/${org}/roles`, { name: "Keeper", canStoreFiles: true });
check("only its admins make its roles", r.status === 403, String(r.status));
r = await call(orgAdmin, "POST", `/teams/${team.id}/roles`, { name: "Keeper", canStoreFiles: true });
check("a team's own role can't give storage: a team has no bucket", r.status === 400, JSON.stringify(r.body));
r = await call(orgAdmin, "POST", `/organizations/${org}/roles`, { name: "Keeper", canReview: true });
check("nor review, which stays the server's", r.status === 400, JSON.stringify(r.body));
const keeper = (await call(orgAdmin, "POST", `/organizations/${org}/roles`, { name: "Keeper", canStoreFiles: true, storageLimitMb: 1 })).body;
check("its admin makes a role that keeps files there, with a storage tier", keeper.canStoreFiles === true && keeper.storageLimitMb === 1, JSON.stringify(keeper));
r = await call(orgAdmin, "POST", `/organizations/${org}/roles`, { name: "Keeper" });
check("…its name its own among the organisation's", r.status === 409, String(r.status));
check("Admin > Roles doesn't list it: it's the organisation's", !(await api(admin, "GET", "/admin/roles")).some((role) => role.id === keeper.id));
r = await call(admin, "PUT", `/admin/users/${player.id}/roles`, { roleIds: [keeper.id, "role_audio_uploads"] });
check("…nor gives it everywhere", r.status === 400, JSON.stringify(r.body));
r = await call(orgAdmin, "PUT", `/organizations/${org}/members/${player.id}/roles`, { roleIds: [keeper.id] });
check("its admin gives it to a member", r.status === 204, JSON.stringify(r.body));
got = await upload(teamSong.id, 0.6 * MB, player);
check("…who keeps files there", got.status === 201 && where(got) === org, JSON.stringify({ status: got.status, message: got.message }));
got = await upload(teamSong.id, 0.6 * MB, player);
check("…within the role's tier", got.status === 413 && got.code === "STORAGE_LIMIT_EXCEEDED", JSON.stringify({ status: got.status, message: got.message }));
const band = (await call(orgAdmin, "POST", `/organizations/${org}/roles`, { name: "Band room", canStoreFiles: true, storageLimitMb: 3 })).body;
r = await call(orgAdmin, "PUT", `/organizations/${org}/teams/${team.id}/roles`, { roleIds: [band.id] });
check("a role given to a whole team", r.status === 204, JSON.stringify(r.body));
await call(orgAdmin, "PUT", `/organizations/${org}/members/${player.id}/roles`, { roleIds: [] });
got = await upload(teamSong.id, 0.6 * MB, player);
check("…counts for its members, with its tier", got.status === 201 && where(got) === org, JSON.stringify({ status: got.status, message: got.message }));
let roles = await api(orgAdmin, "GET", `/organizations/${org}/roles`);
check("its roles, who has each, and its teams'", roles.own.length === 2 && roles.teams.find((one) => one.teamId === team.id)?.roleIds.includes(band.id) && roles.members.find((one) => one.userId === player.id)?.roleIds.length === 0, JSON.stringify(roles));
r = await call(orgAdmin, "PATCH", `/organizations/${org}/roles/${band.id}`, { canStoreFiles: false });
got = await upload(teamSong.id, 0, player);
check("changed so it no longer keeps files: refused again", r.status === 200 && got.status === 403, `${r.status} ${got.status}`);
r = await call(orgAdmin, "DELETE", `/organizations/${org}/roles/${keeper.id}`);
roles = await api(orgAdmin, "GET", `/organizations/${org}/roles`);
check("its admin deletes one", r.status === 204 && roles.own.length === 1, JSON.stringify(roles.own));

// --- a bucket that stops answering
sql(`update "OrganizationStorage" set reachable = false, "lastError" = 'test' where "organizationId" = '${org}'`);
const meanwhile = await upload(teamSong.id);
check("while it isn't answering, new files are kept on the server", where(meanwhile) === "" && onServer(meanwhile));
check("…and the admin is told", (await storage()).reachable === false);
now = await settle();
check("once it answers again, they're moved in", now.reachable === true && where(meanwhile) === org && inBucket(meanwhile) && !onServer(meanwhile), JSON.stringify(now));

// --- a team leaving the organisation takes its files back
const leavingTeam = await api(orgAdmin, "POST", "/teams", { name: `Own storage leaving ${stamp}` });
sql(`update "Team" set "organizationId" = '${org}' where id = '${leavingTeam.id}'`);
const leavingSong = await api(orgAdmin, "POST", "/song-versions", { artists: ["Band"], title: `Own storage leaving ${stamp}`, language: "en", content: "[G]Hi\n", teamId: leavingTeam.id });
const leavingFile = await upload(leavingSong.id);
check("(another team's file, in the bucket)", where(leavingFile) === org && inBucket(leavingFile));
r = await call(orgAdmin, "DELETE", `/organizations/${org}/teams/${leavingTeam.id}`);
check("(the team leaves the organisation)", r.status === 204, String(r.status));
await settle();
check("…and its files are moved back to the server", where(leavingFile) === "" && onServer(leavingFile) && !inBucket(leavingFile));
check("…still read", await reads(leavingFile, leavingSong.id));

// --- stopping
r = await call(outsider, "POST", `/organizations/${org}/storage/stop`);
check("only its admins stop it", r.status === 403, String(r.status));
r = await call(orgAdmin, "POST", `/organizations/${org}/storage/stop`);
check("its admin stops using it: files on their way back", r.status === 201 && (r.body.state === "LEAVING" || r.body.configured === false), JSON.stringify(r.body));
now = await settle();
check("…moved back, then it's disconnected", now.configured === false && [before, after, meanwhile].every((file) => where(file) === "" && onServer(file) && !inBucket(file)), JSON.stringify(now));
check("…every file still read", (await reads(before)) && (await reads(after)) && (await reads(meanwhile)));
r = await call(admin, "DELETE", `/admin/organizations/${org}`);
check("then the organisation can be deleted", r.status === 204, String(r.status));

await call(admin, "DELETE", "/admin/organizations/settings");
finish();
