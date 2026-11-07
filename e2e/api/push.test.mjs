// Web push (issue #236), against a stand-in push service (lib/fake-push.mjs,
// allowed through PUSH_TEST_ORIGINS): an admin generates the VAPID keys
// (the private one never shown); people turn devices on with the public
// key; notifications they want pushed arrive encrypted for each device,
// in their words, held during quiet hours; a test push; a device the push
// service says is gone is forgotten; only push services' addresses.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";
import { FAKE_PUSH_URL, startFakePush } from "../lib/fake-push.mjs";

const push = await startFakePush();
const today = new Date().toISOString().slice(0, 10);
const plus = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const until = async (test, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};
const looked = (userId) => Number(sql(`select count(*) from "Notification" where "userId"='${userId}' and "emailedAt" is not null`));
const pushed = (userId) => Number(sql(`select count(*) from "Notification" where "userId"='${userId}' and "pushedAt" is not null`));

const admin = await user("push admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const singer = await user("push singer");
const other = await user("push other");
const team = (await call(admin, "POST", "/teams", { name: `Push ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmp1${stamp}', '${team.id}', '${singer.id}', 'MEMBER', now(), now())`);
const weekly = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Evening service", date: plus(3), startTime: "18:00", timeZone: "UTC", repeat: { everyWeeks: 1 } })).body;
const base = `/teams/${team.id}/events/${weekly.id}/dates`;
for (const day of [plus(3), plus(10), plus(17), plus(24)]) await call(singer, "PUT", `${base}/${day}/answer`, { answer: "AVAILABLE" });

try {
  // --- not set up
  await call(admin, "DELETE", "/admin/notifications");
  let r = await call(admin, "GET", "/admin/notifications");
  check("push isn't set up to begin with", r.status === 200 && r.body.push.ready === false && r.body.push.source === "none", JSON.stringify(r.body.push));
  const phone = push.device("phone");
  r = await call(singer, "POST", "/users/me/push-subscriptions", { endpoint: phone.endpoint, keys: phone.keys });
  check("…so no device can be turned on", r.status === 400, String(r.status));
  check("…and people get no key", (await call(singer, "GET", "/users/me/notifications/settings")).body.pushKey === null);

  // --- the keys
  r = await call(singer, "POST", "/admin/notifications/vapid-keys");
  check("only global admins make the keys", r.status === 403, String(r.status));
  r = await call(admin, "POST", "/admin/notifications/vapid-keys");
  const publicKey = r.body.publicKey;
  check("an admin generates the key pair", r.status === 201 && typeof publicKey === "string" && publicKey.length > 80, JSON.stringify(r.body));
  r = await call(admin, "GET", "/admin/notifications");
  check("ready, saved, the private key kept and never shown", r.body.push.ready && r.body.push.source === "database" && r.body.push.hasDatabasePrivateKey && r.body.push.publicKey === publicKey && !("privateKey" in r.body.push), JSON.stringify(r.body.push));
  check("the private key is kept encrypted", !sql(`select "vapidPrivateKeyEncrypted" from "NotificationSettings"`).includes(publicKey) && sql(`select "vapidPrivateKeyEncrypted" from "NotificationSettings"`).split(".").length === 3);
  check("people get the public key, to turn devices on", (await call(singer, "GET", "/users/me/notifications/settings")).body.pushKey === publicKey);

  // --- devices
  r = await call(singer, "POST", "/users/me/push-subscriptions", { endpoint: "https://push.evil.example/x", keys: phone.keys });
  check("an address that isn't a push service's: refused", r.status === 400, JSON.stringify(r.body));
  r = await call(singer, "POST", "/users/me/push-subscriptions", { endpoint: "http://169.254.169.254/latest", keys: phone.keys });
  check("…an inside one too", r.status === 400, String(r.status));
  r = await call(singer, "POST", "/users/me/push-subscriptions", { endpoint: phone.endpoint, keys: phone.keys, label: "Chrome · Android", expirationTime: null });
  const phoneId = r.body.id;
  check("a device turned on", r.status === 201 && r.body.label === "Chrome · Android", JSON.stringify(r.body));
  r = await call(singer, "POST", "/users/me/push-subscriptions", { endpoint: phone.endpoint, keys: phone.keys, label: "Chrome · Android" });
  check("…again: still one", r.status === 201 && r.body.id === phoneId && (await call(singer, "GET", "/users/me/push-subscriptions")).body.length === 1);
  r = await call(other, "DELETE", `/users/me/push-subscriptions/${phoneId}`);
  check("someone else can't remove it", r.status === 404, String(r.status));

  // --- a test
  r = await call(other, "POST", "/users/me/push-subscriptions/test");
  check("a test needs a device", r.status === 400, String(r.status));
  r = await call(singer, "POST", "/users/me/push-subscriptions/test");
  check("a test push sent", r.status === 202, String(r.status));
  check("…arrives at the device, signed and encrypted", await until(() => push.for(phone).length === 1), JSON.stringify(push.pushes.map((p) => p.path)));
  const first = push.for(phone)[0];
  check("…with the VAPID signature, a day to live, aes128gcm", first.headers.authorization?.startsWith(`vapid t=`) && first.headers.authorization.includes(`k=${publicKey}`) && first.headers.ttl === "86400" && first.headers["content-encoding"] === "aes128gcm", JSON.stringify(first.headers));
  check("…in their words", first.message?.title === "Songverse" && first.message.body === "Notifications work on this device.", JSON.stringify(first.message));

  // --- a notification pushed
  await call(admin, "PATCH", `${base}/${plus(3)}`, { cancelled: true });
  check("a date cancelled: pushed to the device", await until(() => push.for(phone).length === 2), String(push.for(phone).length));
  const cancelled = push.for(phone)[1].message;
  check("…its words and where it leads", /^Evening service on .+ is cancelled$/.test(cancelled?.title) && cancelled.body === team.name && cancelled.url === "/calendar", JSON.stringify(cancelled));
  const unread = (await call(singer, "GET", "/users/me/notifications/unread")).body.unread;
  check("…with how many are unread, for the app's icon (issue #407)", cancelled.unread === unread && unread >= 1, JSON.stringify([cancelled.unread, unread]));
  check("…marked pushed", await until(() => pushed(singer.id) === 1));

  // --- a kind not wanted pushed
  r = await call(singer, "PUT", "/users/me/notifications/settings", { kinds: { EVENT_DATE_CHANGED: { push: false } } });
  check("a kind turned off for devices", r.body.kinds.EVENT_DATE_CHANGED.push === false && r.body.kinds.EVENT_DATE_CHANGED.email === true);
  await call(admin, "PATCH", `${base}/${plus(10)}`, { startTime: "18:30" });
  await until(() => pushed(singer.id) === 2);
  await new Promise((resolve) => setTimeout(resolve, 500));
  check("…not pushed, still in the bell", pushed(singer.id) === 2 && push.for(phone).length === 2 && (await call(singer, "GET", "/users/me/notifications")).body.items[0].kind === "EVENT_DATE_CHANGED");

  // --- quiet hours
  r = await call(singer, "PUT", "/users/me/notifications/settings", { quiet: { from: "22:00", to: "22:00", timeZone: "UTC" } });
  check("quiet hours that end when they start: refused", r.status === 400, JSON.stringify(r.body));
  r = await call(singer, "PUT", "/users/me/notifications/settings", { quiet: { from: "22:00", to: "07:00", timeZone: "Mars/Olympus" } });
  check("…in a zone that isn't: refused", r.status === 400, JSON.stringify(r.body));
  const hour = (h) => `${String((new Date().getUTCHours() + 24 + h) % 24).padStart(2, "0")}:00`;
  r = await call(singer, "PUT", "/users/me/notifications/settings", { quiet: { from: hour(-1), to: hour(2), timeZone: "UTC" } });
  check("quiet hours now", r.status === 200 && r.body.quiet?.from === hour(-1) && r.body.kinds.EVENT_DATE_CHANGED.push === false, JSON.stringify(r.body));
  const before = Number(sql(`select count(*) from "Notification" where "userId"='${singer.id}'`));
  await call(admin, "PATCH", `${base}/${plus(17)}`, { cancelled: true });
  check("during them: looked at…", await until(() => looked(singer.id) === before + 1), `${looked(singer.id)} ${before}`);
  await new Promise((resolve) => setTimeout(resolve, 800));
  check("…held, not pushed", push.for(phone).length === 2 && pushed(singer.id) === before, `${push.for(phone).length} ${pushed(singer.id)}`);
  r = await call(singer, "PUT", "/users/me/notifications/settings", { quiet: null });
  check("quiet hours off", r.body.quiet === null);

  // --- gone
  const old = push.device("gone");
  await call(singer, "POST", "/users/me/push-subscriptions", { endpoint: old.endpoint, keys: old.keys, label: "Old laptop" });
  await call(singer, "POST", "/users/me/push-subscriptions/test");
  check("a device the push service says is gone is forgotten", await until(() => push.for(old).length === 1) && (await until(() => sql(`select count(*) from "PushSubscription" where endpoint='${old.endpoint}'`) === "0")));
  check("…the others stay", (await call(singer, "GET", "/users/me/push-subscriptions")).body.length === 1);

  // --- why a push failed (issue #237)
  const refusing = push.device("fail");
  await call(other, "POST", "/users/me/push-subscriptions", { endpoint: refusing.endpoint, keys: refusing.keys, label: "Refusing" });
  await call(other, "POST", "/users/me/push-subscriptions/test");
  const failedDevice = async () => (await call(other, "GET", "/users/me/push-subscriptions")).body[0];
  check("a push the push service refuses: why is kept on the device", await until(() => push.for(refusing).length === 1) && (await (async () => { for (let i = 0; i < 40; i++) { if ((await failedDevice())?.lastError) return true; await new Promise((resolve) => setTimeout(resolve, 250)); } return false; })()), JSON.stringify(await failedDevice()));
  const why = (await failedDevice()).lastError;
  check("…its status and what it said", why.includes("403") && why.includes("invalid JWT provided") && why.includes("localhost"), why);
  const failedJob = async () => (await call(admin, "GET", "/admin/jobs")).body.failed.find((job) => job.queue === "notifications" && job.error?.includes("invalid JWT provided"));
  check("a test that reached no device fails its job, with why", await (async () => { for (let i = 0; i < 40; i++) { if (await failedJob()) return true; await new Promise((resolve) => setTimeout(resolve, 250)); } return false; })(), JSON.stringify((await call(admin, "GET", "/admin/jobs")).body.failed.slice(0, 3)));

  r = await call(singer, "DELETE", `/users/me/push-subscriptions/${phoneId}`);
  check("a device removed", r.status === 204 && (await call(singer, "GET", "/users/me/push-subscriptions")).body.length === 0);
  check("the stand-in's address", FAKE_PUSH_URL.startsWith("http://localhost"));

  // --- a saved key this server can't decrypt (another SETTINGS_ENCRYPTION_KEY)
  sql(`update "NotificationSettings" set "vapidPrivateKeyEncrypted"='aaaa.bbbb.cccc'`);
  r = await call(admin, "GET", "/admin/notifications");
  check("a key that can't be decrypted: Admin says so", r.body.push.ready === false && r.body.push.error?.includes("SETTINGS_ENCRYPTION_KEY"), JSON.stringify(r.body.push));
  sql(`update "PushSubscription" set "lastError"=null where "userId"='${other.id}'`);
  r = await call(other, "POST", "/users/me/push-subscriptions/test");
  check("…and people can't send a test", r.status === 400, String(r.status));
} finally {
  await call(admin, "DELETE", "/admin/notifications");
  await push.close();
}

finish();
