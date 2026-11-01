// Teams' and organisations' own Songverse Sonic servers (issue #300), against stand-ins (e2e/lib/fake-demucs.mjs): Admin
// lets teams and organisations connect them (and on private addresses: these are on localhost); a team's admins connect
// theirs, test it, set its limit; its songs are split there by its members, with no role, and its webhooks checked with
// its own secret; an organisation's server serves its teams' songs without one of their own; other songs stay on the
// instance's; disconnecting fails what's being split there; turning the switch off sends everyone back to the instance's.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { FAKE_DEMUCS_KEY, FAKE_DEMUCS_URL, startFakeDemucs, toneWav } from "../lib/fake-demucs.mjs";

const instance = await startFakeDemucs();
const teams = await startFakeDemucs({ port: 3997, key: "team-sonic-key" });
const churches = await startFakeDemucs({ port: 3996, key: "org-sonic-key" });
const admin = await user("Sonic admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("Sonic leader");
const singer = await user("Sonic singer");
const outsider = await user("Sonic outsider");

async function waitFor(who, songId, ready) {
  let body;
  for (let i = 0; i < 60; i++) {
    body = (await call(who, "GET", `/song-versions/${songId}/stem-separations`)).body;
    if (ready(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`waited: ${JSON.stringify(body)}`);
}
async function upload(who, songId, name) {
  const form = new FormData();
  form.append("type", "AUDIO");
  form.append("file", new Blob([toneWav(300, 2)], { type: "audio/wav" }), name);
  return (await fetch(`${API}/song-versions/${songId}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${who.bearer}` }, body: form })).json();
}

try {
  await call(admin, "DELETE", "/admin/stem-separation");
  await call(admin, "PUT", "/admin/stem-separation", { apiUrl: FAKE_DEMUCS_URL, apiKey: FAKE_DEMUCS_KEY, hqEnabled: false });
  const team = (await call(leader, "POST", "/teams", { name: `Sonic team ${stamp}` })).body;
  const link = (await call(leader, "POST", `/teams/${team.id}/invite-links`, {})).body;
  await call(singer, "POST", `/teams/join/${link.token}`);
  const song = await api(leader, "POST", "/song-versions", { title: `Own server ${stamp}`, language: "en", artists: ["Band"], content: "[G]Hi\n", contentFormat: "CHORDPRO", teamId: team.id });
  const recording = await upload(singer, song.id, "Full mix.wav");
  const own = { apiUrl: teams.url, apiKey: teams.key };

  // --- Admin decides
  let r = await call(leader, "GET", `/teams/${team.id}/sonic-server`);
  check("by default teams can't connect their own", r.status === 200 && r.body.allowed === false && r.body.server === null, JSON.stringify(r.body));
  r = await call(leader, "PUT", `/teams/${team.id}/sonic-server`, own);
  check("…so it's refused", r.status === 403, String(r.status));
  r = await call(leader, "PUT", "/admin/stem-separation", { ownServers: true });
  check("only global admins allow it", r.status === 403, String(r.status));
  await call(admin, "PUT", "/admin/stem-separation", { ownServers: true });
  r = await call(leader, "PUT", `/teams/${team.id}/sonic-server`, own);
  check("a local address refused while private addresses aren't allowed", r.status === 400 && /apiUrl isn't allowed: .*https/.test(String(r.body.message)), JSON.stringify(r.body));
  r = await call(leader, "PUT", `/teams/${team.id}/sonic-server`, { ...own, apiUrl: "https://10.0.0.7:8000" });
  check("…so is a private one, even over HTTPS", r.status === 400, JSON.stringify(r.body));
  await call(admin, "PUT", "/admin/stem-separation", { ownServersPrivate: true });

  // --- The team's admins connect it
  r = await call(singer, "PUT", `/teams/${team.id}/sonic-server`, own);
  check("a member who isn't an admin can't", r.status === 403, String(r.status));
  r = await call(outsider, "GET", `/teams/${team.id}/sonic-server`);
  check("nor can someone outside see it", r.status === 403, String(r.status));
  r = await call(leader, "PUT", `/teams/${team.id}/sonic-server`, { apiUrl: teams.url });
  check("the first time, its key is needed", r.status === 400, JSON.stringify(r.body));
  r = await call(leader, "PUT", `/teams/${team.id}/sonic-server`, { ...own, apiUrl: `${teams.url}/`, hqEnabled: false });
  check("connected", r.status === 204, JSON.stringify(r.body));
  r = await call(leader, "GET", `/teams/${team.id}/sonic-server`);
  check("read back, never its key", r.body.allowed && r.body.server.apiUrl === teams.url && r.body.server.hasKey && !JSON.stringify(r.body).includes(teams.key), JSON.stringify(r.body));
  r = await call(leader, "POST", `/teams/${team.id}/sonic-server/test`);
  check("Test connection: what it is, its version, that it finds bars", r.body.ok && r.body.health.service === "songverse-sonic" && r.body.version === "1.6.0" && r.body.beats === true && r.body.models.models.includes("htdemucs"), JSON.stringify(r.body));
  await call(leader, "PUT", `/teams/${team.id}/sonic-server`, { apiKey: "wrong" });
  r = await call(leader, "POST", `/teams/${team.id}/sonic-server/test`);
  check("a wrong key: the test says so", r.body.ok === false && /refused the key/.test(r.body.error), JSON.stringify(r.body));
  await call(leader, "PUT", `/teams/${team.id}/sonic-server`, { apiKey: teams.key });

  // --- Its songs go there: for its admins, and the members given one of its own roles that separates (none of the server's needed)
  r = await call(singer, "GET", `/song-versions/${song.id}/stem-separations`);
  check("a member without one of the team's roles can't", r.body.available === false && r.body.refusal === "not-granted" && r.body.server?.kind === "team", JSON.stringify(r.body));
  r = await call(leader, "GET", `/song-versions/${song.id}/stem-separations`);
  check("its admin may, who runs it", r.body.available === true, JSON.stringify(r.body));
  r = await call(singer, "POST", `/teams/${team.id}/roles`, { name: "Splitter", canSeparateStems: true });
  check("only its admins make its roles", r.status === 403, String(r.status));
  const splitter = (await call(leader, "POST", `/teams/${team.id}/roles`, { name: "Splitter", canSeparateStems: true })).body;
  r = await call(leader, "PUT", `/teams/${team.id}/members/${singer.id}/roles`, { roleIds: [splitter.id] });
  check("its admin gives a member its own role that separates", r.status === 204, JSON.stringify(r.body));
  r = await call(singer, "GET", `/song-versions/${song.id}/stem-separations`);
  check("a member may, on the team's server", r.body.available && r.body.server?.kind === "team" && r.body.server.name === team.name, JSON.stringify(r.body));
  r = await call(outsider, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "4" });
  check("someone outside the team can't", r.status === 403 || r.status === 404, String(r.status));
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "4" });
  check("started", r.status === 201, JSON.stringify(r.body));
  let body = await waitFor(singer, song.id, (b) => b.separations[0]?.status === "COMPLETED");
  check("its stems came from the team's server", teams.received.length === 1 && instance.received.length === 0, `${teams.received.length} / ${instance.received.length}`);
  check("its webhooks go to its own address and were accepted", /\/stem-separation\/callback\/[^/]+$/.test(teams.received[0].callbackUrl ?? "") && teams.webhooks.every((hook) => hook.status === 204), JSON.stringify({ to: teams.received[0].callbackUrl, hooks: teams.webhooks }));
  const forged = await teams.forge(teams.received[0].callbackUrl, "job-1");
  check("a webhook signed with another secret is refused", forged === 403, String(forged));
  const instanceSecretHook = await teams.forge(teams.received[0].callbackUrl.replace(/\/[^/]+$/, ""), "job-1");
  check("…and its jobs aren't the instance's", instanceSecretHook === 403, String(instanceSecretHook));

  // --- Its limit, for whose role has none of its own
  await call(leader, "PUT", `/teams/${team.id}/sonic-server`, { monthlyLimit: 1 });
  r = await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "2" });
  check("the team's limit, counted on its server", r.status === 429, JSON.stringify(r.body));
  await call(leader, "PUT", `/teams/${team.id}/sonic-server`, { monthlyLimit: null });

  // --- Other songs stay on the instance's, with its rules
  const personal = await api(singer, "POST", "/song-versions", { title: `Personal ${stamp}`, language: "en", artists: ["Band"], content: "[G]Hi\n", contentFormat: "CHORDPRO" });
  r = await call(singer, "GET", `/song-versions/${personal.id}/stem-separations`);
  check("a personal song: the instance's server, which needs a role", r.body.available === false && r.body.refusal === "not-granted" && r.body.server === null, JSON.stringify(r.body));

  // --- An organisation's server, for its teams without one
  await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
  const org = (await call(leader, "POST", "/organizations", { name: `Sonic church ${stamp}` })).body;
  const choir = (await call(leader, "POST", "/teams", { name: `Choir ${stamp}` })).body;
  await call(leader, "PUT", `/teams/${choir.id}/organization`, { organizationId: org.id });
  await call(leader, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
  r = await call(singer, "PUT", `/organizations/${org.id}/sonic-server`, { apiUrl: churches.url, apiKey: churches.key });
  check("only the organisation's admins connect its server", r.status === 403, String(r.status));
  r = await call(leader, "PUT", `/organizations/${org.id}/sonic-server`, { apiUrl: churches.url, apiKey: churches.key, hqEnabled: false });
  check("the organisation's connected", r.status === 204, JSON.stringify(r.body));
  const anthem = await api(leader, "POST", "/song-versions", { title: `Choir ${stamp}`, language: "en", artists: ["Band"], content: "[G]Hi\n", contentFormat: "CHORDPRO", teamId: choir.id });
  const anthemRecording = await upload(leader, anthem.id, "Choir.wav");
  r = await call(leader, "GET", `/song-versions/${anthem.id}/stem-separations`);
  check("a team without its own: the organisation's", r.body.server?.kind === "organization" && r.body.server.name === org.name, JSON.stringify(r.body));
  r = await call(singer, "GET", `/song-versions/${song.id}/stem-separations`);
  check("a team with its own keeps it", r.body.server?.kind === "team", JSON.stringify(r.body));
  await call(leader, "POST", `/song-versions/${anthem.id}/attachments/${anthemRecording.id}/separate`, { parts: "4" });
  await waitFor(leader, anthem.id, (b) => b.separations[0]?.status === "COMPLETED");
  check("split on the organisation's server", churches.received.length === 1 && instance.received.length === 0, `${churches.received.length} / ${instance.received.length}`);

  // --- Admin's list
  r = await call(admin, "GET", "/admin/stem-separation/servers");
  const listed = r.body.filter((one) => one.owner.id === team.id || one.owner.id === org.id);
  check("Admin sees whose servers are connected, never their keys", listed.length === 2 && listed.some((one) => one.owner.kind === "organization" && one.separations === 1) && !JSON.stringify(r.body).includes(teams.key), JSON.stringify(listed));

  // --- Disconnecting fails what's being split there
  await call(leader, "PUT", `/teams/${team.id}/sonic-server`, { hqEnabled: true });
  await call(singer, "POST", `/song-versions/${song.id}/attachments/${recording.id}/separate`, { parts: "4", replace: true });
  await waitFor(singer, song.id, (b) => b.separations[0]?.status === "FAST_READY");
  r = await call(singer, "DELETE", `/teams/${team.id}/sonic-server`);
  check("only its admins disconnect it", r.status === 403, String(r.status));
  r = await call(leader, "DELETE", `/teams/${team.id}/sonic-server`);
  check("disconnected", r.status === 204, String(r.status));
  body = (await call(singer, "GET", `/song-versions/${song.id}/stem-separations`)).body;
  check("what was being split there failed, what was split stays", body.separations[0].status === "FAILED" && /disconnected/.test(body.separations[0].error) && body.separations[1].status === "COMPLETED", JSON.stringify(body.separations.map((one) => [one.status, one.error])));
  r = await call(singer, "POST", `/stem-separations/${body.separations[0].id}/retry`);
  check("it can't be tried again on a server that's gone", r.status === 400, JSON.stringify(r.body));
  check("…and the team's song now goes to the organisation's", (await call(singer, "GET", `/song-versions/${song.id}/stem-separations`)).body.server?.kind === "organization");

  // --- Admin turns it off: back to the instance's
  await call(admin, "PUT", "/admin/stem-separation", { ownServers: false });
  r = await call(leader, "GET", `/song-versions/${anthem.id}/stem-separations`);
  check("turned off: the instance's server, with its rules", r.body.server === null && r.body.refusal === "not-granted", JSON.stringify(r.body));
} finally {
  await call(admin, "DELETE", "/admin/stem-separation");
  await call(admin, "DELETE", "/admin/organizations/settings");
  await Promise.all([instance.close(), teams.close(), churches.close()]);
}
finish();
