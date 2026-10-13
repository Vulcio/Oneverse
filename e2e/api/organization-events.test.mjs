// An organisation's events (issue #241): its admins make one with a host
// and the groups it needs, each with the parts it asks it for; each group
// gets its part as one of its own events, whose timing follows the
// organisation's (its admins choose only its parts); the host is told, and
// with the admins sees how every group's parts are covered, changes the
// timing and cancels a date for all of them; presets keep what an event
// usually needs.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("orgev global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("orgev alice");
const drummer = await user("orgev drummer");
const greeter = await user("orgev greeter");
const host = await user("orgev host");
const outsider = await user("orgev outsider");
sql(`update "User" set instruments='{DRUMS}' where id='${drummer.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
const org = (await call(alice, "POST", "/organizations", { name: `Events church ${stamp}` })).body;
const elsewhere = (await call(outsider, "POST", "/organizations", { name: `Elsewhere ${stamp}` })).body;
const music = (await call(alice, "POST", "/teams", { name: `Music ${stamp}` })).body;
await call(alice, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
await call(drummer, "POST", `/teams/join/${(await call(alice, "POST", `/teams/${music.id}/invite-links`, {})).body.token}`);
const welcome = (await call(alice, "POST", `/organizations/${org.id}/groups`, { name: `Welcome ${stamp}` })).body;
await call(greeter, "POST", `/teams/join/${(await call(alice, "POST", `/teams/${welcome.id}/invite-links`, {})).body.token}`);
const greeterPosition = (await call(alice, "POST", `/teams/${welcome.id}/positions`, { name: "Greeter" })).body;
await call(greeter, "PUT", `/teams/${welcome.id}/members/${greeter.id}/positions`, { positionIds: [greeterPosition.id] });
await call(host, "POST", `/organizations/join/${(await call(alice, "POST", `/organizations/${org.id}/invite-links`, {})).body.token}`);
const otherGroup = (await call(outsider, "POST", `/organizations/${elsewhere.id}/groups`, { name: "Not theirs" })).body;
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);

const first = plus(6);
const base = `/organizations/${org.id}`;
const event = {
  title: "Sunday service",
  date: first,
  startTime: "10:00",
  durationMinutes: 120,
  timeZone: "UTC",
  place: "Main hall",
  repeat: { everyWeeks: 1 },
  hostUserId: host.id,
  needs: [
    { teamId: music.id, parts: [{ part: "DRUMS", count: 1 }] },
    { teamId: welcome.id, parts: [{ position: greeterPosition.id, count: 2 }] },
  ],
};

// --- making one
let r = await call(greeter, "POST", `${base}/events`, event);
check("only the organisation's admins make its events", r.status === 403, String(r.status));
r = await call(alice, "POST", `${base}/events`, { ...event, hostUserId: outsider.id });
check("a host from outside it: refused", r.status === 400, JSON.stringify(r.body));
r = await call(alice, "POST", `${base}/events`, { ...event, needs: [{ teamId: otherGroup.id }] });
check("a group of another organisation: refused", r.status === 400, JSON.stringify(r.body));
r = await call(alice, "POST", `${base}/events`, { ...event, needs: [{ teamId: music.id, parts: [{ position: greeterPosition.id, count: 1 }] }] });
check("another group's position as a part: refused, nothing kept", r.status === 400 && (await call(alice, "GET", `${base}/events`)).body.length === 0, JSON.stringify(r.body));
r = await call(alice, "POST", `${base}/events`, event);
const made = r.body;
check("made: its host, the groups it needs with their parts", r.status === 201 && made.host?.id === host.id && made.needs.length === 2 && made.needs.find((n) => n.teamId === welcome.id)?.parts[0].position === greeterPosition.id, JSON.stringify(r.body));
check("the host is told", (await notes(host, "HOSTING"))[0]?.data.event === "Sunday service");
const musicEvents = (await call(alice, "GET", `/teams/${music.id}/events`)).body;
const musicPart = musicEvents.find((one) => one.organizationEventId === made.id);
check("each group has its part on its calendar, saying who plans it", musicPart?.planned?.organizationName === org.name && musicPart.planned.hostName === "orgev host" && musicPart.startTime === "10:00", JSON.stringify(musicPart));
const musicDate = (await call(alice, "GET", `/teams/${music.id}/event-dates?from=${first}&to=${first}`)).body.find((one) => one.eventId === musicPart.id);
const welcomePart = (await call(alice, "GET", `/teams/${welcome.id}/events`)).body.find((one) => one.organizationEventId === made.id);
const welcomeDate = (await call(alice, "GET", `/teams/${welcome.id}/event-dates?from=${first}&to=${first}`)).body.find((one) => one.eventId === welcomePart.id);
check("the music team's date has its set; the group that only plans, none", !!musicDate?.setlistId && welcomeDate?.setlistId === null, `${musicDate?.setlistId} ${welcomeDate?.setlistId}`);

// --- a group's admins choose its parts, nothing else
const teamBase = `/teams/${music.id}/events/${musicPart.id}`;
r = await call(alice, "PATCH", teamBase, { startTime: "09:00" });
check("its timing: the organisation's", r.status === 400, JSON.stringify(r.body));
r = await call(alice, "PATCH", teamBase, { parts: [{ part: "DRUMS", count: 1 }, { part: "BASS_GUITAR", count: 1 }] });
check("its parts: the group's", r.status === 200 && r.body.parts.length === 2, JSON.stringify(r.body));
r = await call(alice, "DELETE", teamBase);
check("not deleted from the group", r.status === 400, String(r.status));
r = await call(alice, "PATCH", `${teamBase}/dates/${first}`, { cancelled: true });
check("nor a date cancelled there", r.status === 400, String(r.status));

// --- the dates, as the host sees them and as others do
await call(drummer, "PUT", `${teamBase}/dates/${first}/answer`, { answer: "AVAILABLE" });
r = await call(host, "GET", `${base}/event-dates?from=${first}&to=${first}`);
const seen = r.body[0];
const drums = seen?.groups.find((g) => g.teamId === music.id)?.coverage?.find((part) => part.key === "DRUMS");
check("the host sees every group's coverage", r.status === 200 && seen.groups.length === 2 && seen.canManage && drums?.available === 1 && drums.missing === 0 && seen.groups.find((g) => g.teamId === welcome.id).coverage[0].missing === 2, JSON.stringify(seen));
r = await call(greeter, "GET", `${base}/event-dates?from=${first}&to=${first}`);
check("others see the groups, not the coverage", r.status === 200 && r.body[0].groups.every((g) => g.coverage === null) && r.body[0].canManage === false && r.body[0].groups.find((g) => g.teamId === welcome.id).mine, JSON.stringify(r.body[0]));
r = await call(outsider, "GET", `${base}/event-dates?from=${first}&to=${first}`);
check("someone outside the organisation: not found", r.status === 404, String(r.status));

// --- changing it
r = await call(host, "PATCH", `${base}/events/${made.id}`, { startTime: "11:00", place: "" });
check("the host changes its timing: every group's part follows", r.status === 200 && (await call(alice, "GET", `/teams/${welcome.id}/events/${welcomePart.id}`)).body.startTime === "11:00", JSON.stringify(r.body));
r = await call(host, "PATCH", `${base}/events/${made.id}`, { hostUserId: greeter.id });
check("…but doesn't hand it over", r.status === 403, String(r.status));
r = await call(alice, "PATCH", `${base}/events/${made.id}`, { hostUserId: greeter.id });
check("the admins choose another host, who's told", r.status === 200 && r.body.host.id === greeter.id && (await notes(greeter, "HOSTING")).length === 1, JSON.stringify(r.body.host));
r = await call(greeter, "PATCH", `${base}/events/${made.id}/dates/${first}`, { cancelled: true });
const cancelled = (await call(alice, "GET", `${base}/event-dates?from=${first}&to=${first}`)).body[0];
check("a date cancelled for every group", r.status === 204 && cancelled.cancelled && cancelled.groups.every((g) => g.cancelled), JSON.stringify(cancelled));
await call(greeter, "PATCH", `${base}/events/${made.id}/dates/${first}`, { cancelled: false });
r = await call(alice, "PATCH", `${base}/events/${made.id}`, { needs: [{ teamId: music.id }] });
check("a group no longer needed loses its part", r.status === 200 && r.body.needs.length === 1 && !(await call(alice, "GET", `/teams/${welcome.id}/events`)).body.some((one) => one.organizationEventId === made.id), JSON.stringify(r.body.needs));
check("…a group kept keeps its parts", r.body.needs[0].parts.length === 2, JSON.stringify(r.body.needs[0]));
r = await call(alice, "PATCH", `${base}/events/${made.id}`, { needs: [{ teamId: music.id }, { teamId: welcome.id, parts: [{ position: greeterPosition.id, count: 1 }] }] });
const back = (await call(alice, "GET", `/teams/${welcome.id}/events`)).body.find((one) => one.organizationEventId === made.id);
check("a group needed again gets its part, at the event's time", r.status === 200 && back?.startTime === "11:00" && back.parts[0].count === 1, JSON.stringify(back));

// --- presets
const preset = { name: `Sunday ${stamp}`, title: "Sunday service", startTime: "10:00", durationMinutes: 120, needs: event.needs };
r = await call(greeter, "POST", `${base}/event-presets`, preset);
check("only the admins make presets", r.status === 403, String(r.status));
r = await call(alice, "POST", `${base}/event-presets`, preset);
const saved = r.body;
check("a preset kept", r.status === 201 && saved.needs.length === 2 && saved.startTime === "10:00", JSON.stringify(r.body));
r = await call(alice, "POST", `${base}/event-presets`, preset);
check("…its name once", r.status === 409, String(r.status));
r = await call(greeter, "GET", `${base}/event-presets`);
check("members see them", r.status === 200 && r.body.some((one) => one.id === saved.id), String(r.status));
r = await call(alice, "DELETE", `${base}/event-presets/${saved.id}`);
check("removed", r.status === 204 && (await call(alice, "GET", `${base}/event-presets`)).body.length === 0, String(r.status));

// --- a group leaving, then the event gone
r = await call(alice, "DELETE", `${base}/teams/${welcome.id}`);
const kept = (await call(alice, "GET", `/teams/${welcome.id}/events`)).body.find((one) => one.id === back.id);
check("a group out of the organisation keeps its part, as its own", r.status === 204 && kept?.organizationEventId === null && kept.planned === null, JSON.stringify(kept));
r = await call(greeter, "DELETE", `${base}/events/${made.id}`);
check("only the admins delete an event", r.status === 403, String(r.status));
r = await call(alice, "DELETE", `${base}/events/${made.id}`);
check("deleted: the groups' parts with it", r.status === 204 && !(await call(alice, "GET", `/teams/${music.id}/events`)).body.some((one) => one.id === musicPart.id), String(r.status));

await call(admin, "DELETE", "/admin/organizations/settings");
finish();
