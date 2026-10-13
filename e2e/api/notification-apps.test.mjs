// Notifications to the right app (issue #241): one about a group that only
// plans, or an organisation's event, is Planiverse's - its email links to
// Planiverse, its push goes to the devices turned on in Planiverse; one
// about a Songverse team stays Songverse's. Someone with no device of that
// app gets it on the ones they have.
import { existsSync, readFileSync } from "node:fs";
import { API, PLANIVERSE, WEB, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { startFakePush } from "../lib/fake-push.mjs";

const WORKER_LOG = process.env.E2E_WORKER_LOG ?? "/tmp/worker.log";
const workerLog = () => (existsSync(WORKER_LOG) ? readFileSync(WORKER_LOG, "utf8") : "");
const today = new Date().toISOString().slice(0, 10);
const plus = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const until = async (test, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};
/** A device turned on in a page of `origin` (the browser sends it). */
const turnOn = (who, device, origin) =>
  fetch(`${API}/users/me/push-subscriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${who.bearer}`, "Content-Type": "application/json", ...(origin && { Origin: origin }) },
    body: JSON.stringify({ endpoint: device.endpoint, keys: device.keys }),
  }).then((response) => response.status);

const push = await startFakePush();
const admin = await user("apps admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const singer = await user("apps singer");
const usher = await user("apps usher");

try {
  await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
  await call(admin, "POST", "/admin/notifications/vapid-keys");
  await call(admin, "PUT", "/admin/notifications", { emailEnabled: true });
  const org = (await call(admin, "POST", "/organizations", { name: `Apps ${stamp}` })).body;
  const welcome = (await call(admin, "POST", `/organizations/${org.id}/groups`, { name: `Welcome ${stamp}` })).body;
  const music = (await call(admin, "POST", "/teams", { name: `Music ${stamp}` })).body;
  for (const [team, who, n] of [[welcome, singer, 1], [music, singer, 2], [welcome, usher, 3]]) {
    sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tma${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`);
  }
  const eventOf = async (team, title) => {
    const event = (await call(admin, "POST", `/teams/${team.id}/events`, { title, date: plus(3), startTime: "10:00", timeZone: "UTC" })).body;
    return `/teams/${team.id}/events/${event.id}/dates/${plus(3)}`;
  };
  const welcomeDate = await eventOf(welcome, `Door ${stamp}`);
  const musicDate = await eventOf(music, `Service ${stamp}`);
  for (const [who, date] of [[singer, welcomeDate], [singer, musicDate], [usher, welcomeDate]]) await call(who, "PUT", `${date}/answer`, { answer: "AVAILABLE" });

  const phone = push.device("phone");
  const laptop = push.device("laptop");
  const usherLaptop = push.device("usher-laptop");
  check("a device turned on in Planiverse", (await turnOn(singer, phone, PLANIVERSE)) === 201 && sql(`select app from "PushSubscription" where endpoint='${phone.endpoint}'`) === "planiverse");
  check("…one in Songverse", (await turnOn(singer, laptop, WEB)) === 201 && sql(`select coalesce(app, 'songverse') from "PushSubscription" where endpoint='${laptop.endpoint}'`) === "songverse");
  await turnOn(usher, usherLaptop, WEB);

  await call(admin, "PATCH", welcomeDate, { cancelled: true });
  check("a date of a group that only plans cancelled: Planiverse's", await until(() => sql(`select count(*) from "Notification" where "userId"='${singer.id}' and app='planiverse'`) === "1"));
  check("…pushed to the device turned on in Planiverse, not the other", (await until(() => push.for(phone).length === 1)) && push.for(laptop).length === 0, `${push.for(phone).length} ${push.for(laptop).length}`);
  check("…its email opens Planiverse", await until(() => workerLog().includes(`Open in Planiverse: ${PLANIVERSE}/calendar`)), workerLog().slice(-600));
  check("someone with only a Songverse device gets it there", await until(() => push.for(usherLaptop).length === 1));

  await call(admin, "PATCH", musicDate, { cancelled: true });
  check("a Songverse team's date cancelled: Songverse's", await until(() => sql(`select count(*) from "Notification" where "userId"='${singer.id}' and app is null`) === "1"));
  check("…pushed to the Songverse device only", (await until(() => push.for(laptop).length === 1)) && push.for(phone).length === 1, `${push.for(phone).length} ${push.for(laptop).length}`);

  const host = (await call(admin, "POST", `/organizations/${org.id}/invite-links`, {})).body;
  await call(usher, "POST", `/organizations/join/${host.token}`);
  await call(admin, "POST", `/organizations/${org.id}/events`, { title: `Gathering ${stamp}`, date: plus(5), startTime: "18:00", timeZone: "UTC", hostUserId: usher.id, needs: [{ teamId: welcome.id, parts: [] }] });
  check("hosting an organisation's event: Planiverse's", await until(() => sql(`select count(*) from "Notification" where "userId"='${usher.id}' and kind='HOSTING' and app='planiverse'`) === "1"));
} finally {
  await call(admin, "DELETE", "/admin/notifications");
  await call(admin, "DELETE", "/admin/organizations/settings");
  await push.close();
}
finish();
