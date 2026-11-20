// Notifications by email (issue #236): off on the server until an admin
// turns them on (Admin > Notifications); then the notifications job emails
// each person, in their language, the kinds they want by email - one email
// for a batch made together. Each person chooses per kind in their account.
import { existsSync, readFileSync } from "node:fs";
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

// The Worker's output: emails are written there when no Resend key is set.
const WORKER_LOG = process.env.E2E_WORKER_LOG ?? "/tmp/worker.log";
const workerLog = () => (existsSync(WORKER_LOG) ? readFileSync(WORKER_LOG, "utf8") : "");

const today = new Date().toISOString().slice(0, 10);
const plus = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const until = async (what, test, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};
const looked = (userId) => Number(sql(`select count(*) from "Notification" where "userId"='${userId}' and "emailedAt" is not null`));

const admin = await user("mail admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const singer = await user("mail singer");
const drummer = await user("mail drummer");
sql(`update "User" set locale='fr' where id='${drummer.id}'`);
const team = (await call(admin, "POST", "/teams", { name: `Mail ${stamp}` })).body;
const join = (who, n) => sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmm${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`);
join(singer, 1);
join(drummer, 2);
const weekly = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Evening service", date: plus(3), startTime: "18:00", timeZone: "UTC", repeat: { everyWeeks: 1 } })).body;
const base = `/teams/${team.id}/events/${weekly.id}/dates`;
for (const day of [plus(3), plus(10)]) {
  await call(singer, "PUT", `${base}/${day}/answer`, { answer: "AVAILABLE" });
  await call(drummer, "PUT", `${base}/${day}/answer`, { answer: "AVAILABLE" });
}

// --- the server's switch
await call(admin, "DELETE", "/admin/notifications");
let r = await call(admin, "GET", "/admin/notifications");
check("off by default", r.status === 200 && r.body.settings.emailEnabled.value === false && ["default", "env"].includes(r.body.settings.emailEnabled.source) && r.body.settings.emailEnabled.env === "NOTIFICATION_EMAILS", JSON.stringify(r.body));
r = await call(singer, "GET", "/admin/notifications");
check("only global admins see it", r.status === 403, String(r.status));
r = await call(singer, "PUT", "/admin/notifications", { emailEnabled: true });
check("…or change it", r.status === 403, String(r.status));

// --- one's own choices
r = await call(singer, "GET", "/users/me/notifications/settings");
// Announcements (issue #536) are pushed, not emailed, until one chooses.
const announcementKinds = ["ANNOUNCEMENT", "ORGANIZATION_ANNOUNCEMENT"];
check(
  "each kind by email until one chooses, but announcements; the server doesn't email yet",
  r.status === 200 && Object.entries(r.body.kinds).every(([kind, on]) => on.email === !announcementKinds.includes(kind) && on.push === true) && r.body.emailAvailable === false,
  JSON.stringify(r.body),
);
r = await call(singer, "PUT", "/users/me/notifications/settings", { kinds: { EVENT_DATE_CHANGED: { email: false } } });
check("one kind off by email, the rest kept", r.status === 200 && r.body.kinds.EVENT_DATE_CHANGED.email === false && r.body.kinds.EVENT_DATE_CANCELLED.email === true, JSON.stringify(r.body));
r = await call(singer, "PUT", "/users/me/notifications/settings", { kinds: { NOPE: { email: false } } });
check("a kind that isn't: refused", r.status === 400, String(r.status));
r = await call(singer, "PUT", "/users/me/notifications/settings", { kinds: { EVENT_CANCELLED: { sms: true } } });
check("a channel that isn't: refused", r.status === 400, String(r.status));

// --- off on the server: looked at, not sent
let offset = workerLog().length;
await call(admin, "PATCH", `${base}/${plus(3)}`, { cancelled: true });
check("the email job looks at them", await until("looked", () => looked(singer.id) === 1 && looked(drummer.id) === 1), `${looked(singer.id)} ${looked(drummer.id)}`);
check("…and sends nothing while the server doesn't email", !workerLog().slice(offset).includes(singer.email) && !workerLog().slice(offset).includes(drummer.email));

// --- on
r = await call(admin, "PUT", "/admin/notifications", { emailEnabled: true });
check("an admin turns emails on", r.status === 204 && (await call(admin, "GET", "/admin/notifications")).body.settings.emailEnabled.source === "database", String(r.status));
r = await call(singer, "GET", "/users/me/notifications/settings");
check("…people see the server emails", r.body.emailAvailable === true);

offset = workerLog().length;
await call(admin, "PATCH", `${base}/${plus(3)}`, { cancelled: false });
await call(admin, "PATCH", `/teams/${team.id}/events/${weekly.id}`, { startTime: "19:00" });
check("the batch is looked at", await until("looked", () => looked(drummer.id) === 3 && looked(singer.id) === 3), `${looked(singer.id)} ${looked(drummer.id)}`);
const sent = workerLog().slice(offset);
check("one email for the batch, in their language, with a link into the app", await until("sent", () => workerLog().slice(offset).includes(`To: ${drummer.email}\nSubject: 2 nouvelles de Songverse`)) && workerLog().slice(offset).includes("Ouvrir dans Songverse: http"), workerLog().slice(offset).slice(0, 600));
check("a kind someone turned off isn't emailed to them", !sent.includes(`To: ${singer.email}`), sent.slice(0, 600));

// --- an admin answering for someone, emailed to them
offset = workerLog().length;
await call(admin, "PUT", `${base}/${plus(17)}/answers/${singer.id}`, { answer: "IF_NEEDED" });
check("answered for: emailed", await until("sent", () => workerLog().slice(offset).includes(`To: ${singer.email}\nSubject: mail admin answered for you: If needed`)), workerLog().slice(offset).slice(0, 400));

// --- an unverified address gets nothing
sql(`update "User" set "emailVerified"=false where id='${drummer.id}'`);
offset = workerLog().length;
await call(admin, "PATCH", `${base}/${plus(10)}`, { cancelled: true });
await until("looked", () => looked(drummer.id) === 4);
check("an address not verified isn't emailed", looked(drummer.id) === 4 && !workerLog().slice(offset).includes(drummer.email));

// --- back to the environment
r = await call(admin, "DELETE", "/admin/notifications");
check("back to the environment variables", r.status === 204 && (await call(admin, "GET", "/admin/notifications")).body.settings.emailEnabled.source !== "database");

finish();
