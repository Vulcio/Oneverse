// A personal calendar link (issue #235): an iCalendar feed, opened without
// signing in, of the dates one signed up for (answered Available) - not
// If needed, Not available, cancelled dates or other teams' - each with
// its team, place and set; reset (the old link stops) or turned off.
import { API, stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const today = new Date().toISOString().slice(0, 10);
const plus = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const admin = await user("feed admin");
const singer = await user("feed singer");
const team = (await call(admin, "POST", "/teams", { name: `Feed ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmf${stamp}', '${team.id}', '${singer.id}', 'MEMBER', now(), now())`);
const event = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Morning service", date: plus(3), startTime: "10:00", durationMinutes: 120, callMinutes: 45, timeZone: "Europe/Paris", place: "Main hall; side door", note: "Arrive at 9:15", repeat: { everyWeeks: 1 } })).body;
const base = `/teams/${team.id}/events/${event.id}/dates`;
await call(singer, "PUT", `${base}/${plus(3)}/answer`, { answer: "AVAILABLE" });
await call(singer, "PUT", `${base}/${plus(10)}/answer`, { answer: "IF_NEEDED" });
await call(singer, "PUT", `${base}/${plus(17)}/answer`, { answer: "AVAILABLE" });
await call(singer, "PUT", `${base}/${plus(24)}/answer`, { answer: "AVAILABLE" });
await call(admin, "PATCH", `${base}/${plus(24)}`, { cancelled: true });

let r = await call(singer, "GET", "/users/me/calendar-feed");
check("no link until asked for", r.status === 200 && r.body.url === null, JSON.stringify(r.body));
r = await call(singer, "POST", "/users/me/calendar-feed");
const url = r.body.url;
check("a link made: the API's address, a long token, .ics", r.status === 201 && url.startsWith(`${API}/calendar/`) && /\/calendar\/[A-Za-z0-9_-]{40,}\.ics$/.test(url), url);

let res = await fetch(url);
const body = await res.text();
check("opened without signing in, as a calendar", res.status === 200 && res.headers.get("content-type").startsWith("text/calendar") && body.startsWith("BEGIN:VCALENDAR\r\n") && body.endsWith("END:VCALENDAR\r\n"), `${res.status} ${res.headers.get("content-type")}`);
const unfolded = body.replace(/\r\n /g, "");
const starts = [...unfolded.matchAll(/^DTSTART:(\S+)$/gm)].map((m) => m[1]);
const ical = (date) => date.replace(/-/g, "");
check("only the dates signed up for: not If needed, not cancelled", starts.length === 2 && starts[0].startsWith(ical(plus(3))) && starts[1].startsWith(ical(plus(17))), starts.join(" "));
check("each with its team, place (escaped), note and set", unfolded.includes(`SUMMARY:Morning service (Feed ${stamp})`) && unfolded.includes("LOCATION:Main hall\\; side door") && unfolded.includes("Arrive at 9:15") && /URL:http\S+\/sets\/\S+/.test(unfolded), unfolded.split("\r\n").filter((l) => /^(SUMMARY|LOCATION|URL)/.test(l)).join(" | "));
check("…and its call time (issue #240), in the reader's language", unfolded.includes("DESCRIPTION:Call 09:15\\n"), unfolded.split("\r\n").find((l) => l.startsWith("DESCRIPTION")));
check("stable IDs, so calendars update the entries", unfolded.includes(`UID:${event.id}-${plus(3)}@songverse`));
check("calendars told how often to look again", unfolded.includes("REFRESH-INTERVAL;VALUE=DURATION:PT60M"));

const etag = res.headers.get("etag");
res = await fetch(url, { headers: { "If-None-Match": etag } });
check("nothing changed: 304", res.status === 304, String(res.status));
await call(singer, "PUT", `${base}/${plus(10)}/answer`, { answer: "AVAILABLE" });
res = await fetch(url, { headers: { "If-None-Match": etag } });
check("a new answer: the feed changes", res.status === 200 && (await res.text()).includes(`DTSTART:${ical(plus(10))}`), String(res.status));

r = await call(singer, "POST", "/users/me/calendar-feed");
check("reset: a new link", r.status === 201 && r.body.url !== url);
check("…the old one stops", (await fetch(url)).status === 404);
check("…the new one works", (await fetch(r.body.url)).status === 200);
check("an address that isn't a feed", (await fetch(`${API}/calendar/nope.ics`)).status === 404);

r = await call(singer, "DELETE", "/users/me/calendar-feed");
check("turned off", r.status === 204 && (await call(singer, "GET", "/users/me/calendar-feed")).body.url === null);

finish();
