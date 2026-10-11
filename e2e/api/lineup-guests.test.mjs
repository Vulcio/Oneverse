// Guests on a line-up (issue #235, phase 7): an admin schedules one of
// their People (#79) who isn't in the team - they're told, answer for their
// place, see the date on My calendar and its set (read-only), and lose it
// when taken off - or someone without an account, by name, for reference
// only (accepted, never told). Anyone else: refused.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("guest admin");
const bassist = await user("guest bassist");
const stranger = await user("guest stranger");
const team = (await call(admin, "POST", "/teams", { name: `Guests ${stamp}` })).body;
sql(`insert into "Connection" (id, "requesterId", "addresseeEmail", "addresseeId", status, "respondedAt") values ('cng${stamp}', '${admin.id}', '${bassist.email}', '${bassist.id}', 'ACCEPTED', now())`);
const date = plus(3);
const event = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Sunday", date, startTime: "10:00", timeZone: "UTC", parts: [{ part: "BASS_GUITAR", count: 1 }, { part: "DRUMS", count: 1 }] })).body;
const base = `/teams/${team.id}/events/${event.id}/dates/${date}`;
const notes = async (who, kind) => (await call(who, "GET", "/users/me/notifications?limit=100")).body.items.filter((item) => item.kind === kind);
const adminDate = async () => (await call(admin, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`)).body[0];

let r = await call(admin, "POST", `${base}/lineup`, { userId: stranger.id, part: "BASS_GUITAR" });
check("someone neither in the team nor one's People: refused", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "POST", `${base}/lineup`, { userId: bassist.id, guestName: "Bea", part: "BASS_GUITAR" });
check("a user and a name at once: refused", r.status === 400, String(r.status));
r = await call(admin, "POST", `${base}/lineup`, { userId: bassist.id, part: "BASS_GUITAR" });
const place = r.body;
check("one of the admin's People: scheduled as a guest, asked", r.status === 201 && place.guest === "account" && place.status === "PENDING", JSON.stringify(r.body));
check("…and told", (await notes(bassist, "SCHEDULED"))[0]?.data.part === "BASS_GUITAR");
const setlistId = (await adminDate()).setlistId;
r = await call(bassist, "GET", `/setlists/${setlistId}`);
check("the guest sees the date's set", r.status === 200 && !!setlistId, `${r.status} ${setlistId}`);
r = await call(bassist, "GET", `/teams/${team.id}/event-dates?from=${date}&to=${date}`);
check("…not the team's calendar", r.status === 403, String(r.status));
const mine = (await call(bassist, "GET", `/users/me/event-dates?from=${plus(0)}&to=${plus(30)}`)).body.filter((one) => one.eventId === event.id);
check("My calendar: that date only, as a guest, with their place", mine.length === 1 && mine[0].guest === true && mine[0].lineup.some((one) => one.mine && one.guest === "account"), JSON.stringify(mine.map((one) => [one.date, one.guest])));
r = await call(bassist, "PUT", `${base}/lineup/${place.id}/response`, { status: "ACCEPTED" });
check("the guest accepts their place", r.status === 200 && r.body.status === "ACCEPTED", JSON.stringify(r.body));

// --- without an account
r = await call(admin, "POST", `${base}/lineup`, { guestName: "Mo (sub)", part: "DRUMS" });
check("someone without an account, by name: on the line-up, accepted", r.status === 201 && r.body.userId === null && r.body.guest === "external" && r.body.status === "ACCEPTED" && r.body.displayName === "Mo (sub)", JSON.stringify(r.body));
const seen = await adminDate();
check("the line-up shows both guests; the parts are filled", seen.lineup.length === 2 && seen.coverage.every((part) => part.missing === 0), JSON.stringify(seen.lineup.map((one) => [one.displayName, one.guest])));
check("signed up: the guest with an account", (await call(bassist, "GET", "/setlists")).body.find((set) => set.id === setlistId)?.signedUp === true);

// --- taken off
r = await call(admin, "DELETE", `${base}/lineup/${place.id}`);
check("the guest taken off: told", r.status === 204 && (await notes(bassist, "UNSCHEDULED")).length === 1);
r = await call(bassist, "GET", `/setlists/${setlistId}`);
check("…and no longer sees the set", r.status === 403 || r.status === 404, String(r.status));
r = await call(admin, "DELETE", `${base}/lineup/${seen.lineup.find((one) => one.guest === "external").id}`);
check("a guest without an account taken off", r.status === 204 && (await adminDate()).lineup.length === 0);

finish();
