// API-level smoke test for self-service profile: display name (first and last), theme, avatar, storage usage, email change.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { STORAGE_DIR, API, ORIGIN, LOG, stamp, sql, check, finish } from "../lib/harness.mjs";

async function waitForLink(offset, pattern) {
  for (let i = 0; i < 40; i++) {
    const match = readFileSync(LOG, "utf8").slice(offset).match(pattern);
    if (match) return match[0];
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no link matching ${pattern}`);
}
const verifyLink = /https?:\/\/[^\s]+?\/api\/auth\/verify-email\?token=[^\s]+/;

const email = `um-profile-${stamp}@example.com`;
let offset = readFileSync(LOG, "utf8").length;
await fetch(`${API}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ORIGIN },
  body: JSON.stringify({ email, password: "hunter2pass", name: "Profile Tester" }),
});
await fetch(await waitForLink(offset, verifyLink), { redirect: "manual" });

const signInRes = await fetch(`${API}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ORIGIN },
  body: JSON.stringify({ email, password: "hunter2pass" }),
});
const cookie = signInRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const bearer = (await (await fetch(`${API}/api/auth/token`, { headers: { cookie, Origin: ORIGIN } })).json()).token;
const call = (method, path, body) =>
  fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body && !(body instanceof FormData) && { "Content-Type": "application/json" }) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });

// display name
let me = await (await call("PATCH", "/users/me", { displayName: "  New Name  " })).json();
check("display name updated and trimmed", me.displayName === "New Name", me.displayName);
let res = await call("PATCH", "/users/me", { displayName: "   " });
check("blank display name rejected", res.status === 400, String(res.status));
const session = await (await fetch(`${API}/api/auth/get-session`, { headers: { cookie, Origin: ORIGIN } })).json();
check("session reflects new name", session?.user?.name === "New Name", session?.user?.name);

// a name in two parts, and light or dark on the account (issue #540)
check("a name never set in two is split at its first space", me.firstName === "New" && me.lastName === "Name", `${me.firstName}|${me.lastName}`);
me = await (await call("PATCH", "/users/me", { firstName: " Jean Paul ", lastName: "Martin" })).json();
check("first and last name kept, joined as the name others see", me.firstName === "Jean Paul" && me.lastName === "Martin" && me.displayName === "Jean Paul Martin", JSON.stringify([me.firstName, me.lastName, me.displayName]));
res = await call("PATCH", "/users/me", { firstName: "", lastName: " " });
check("both parts empty rejected", res.status === 400, String(res.status));
me = await (await call("PATCH", "/users/me", { displayName: "One Name" })).json();
check("a plain name resets the parts", me.firstName === "One" && me.lastName === "Name", `${me.firstName}|${me.lastName}`);
check("no theme chosen yet", me.theme === null, String(me.theme));
me = await (await call("PATCH", "/users/me", { theme: "dark" })).json();
check("theme kept on the account", me.theme === "dark", String(me.theme));
const themed = await (await fetch(`${API}/api/auth/get-session`, { headers: { cookie, Origin: ORIGIN } })).json();
check("the session carries the theme", themed?.user?.theme === "dark", String(themed?.user?.theme));
res = await call("PATCH", "/users/me", { theme: "sepia" });
check("an unknown theme rejected", res.status === 400, String(res.status));
me = await (await call("PATCH", "/users/me", { theme: "auto" })).json();
check("auto follows each device", me.theme === "auto", String(me.theme));

// storage usage
const usage = await (await call("GET", "/users/me/storage")).json();
check("storage usage with 50 MB default", usage.usedBytes === 0 && usage.limitBytes === 50 * 1024 * 1024, JSON.stringify(usage));

// avatar
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
let form = new FormData();
form.append("file", new Blob([png], { type: "image/png" }), "me.png");
me = await (await call("PUT", "/users/me/avatar", form)).json();
check("avatar uploaded", me.avatarUrl?.startsWith(`${API}/users/`), me.avatarUrl);
res = await fetch(me.avatarUrl);
check("avatar served publicly, normalized to WebP", res.status === 200 && res.headers.get("content-type") === "image/webp" && res.headers.get("cache-control")?.includes("immutable"), `${res.status} ${res.headers.get("content-type")}`);

const someAttachmentKey = sql(`select "storageKey" from "Attachment" limit 1`);
res = await fetch(`${API}/users/${me.id}/avatar/${someAttachmentKey}`);
check("avatar route won't serve other storage keys", res.status === 404, String(res.status));

form = new FormData();
form.append("file", new Blob([Buffer.from("<svg onload=alert(1)></svg>")], { type: "image/png" }), "evil.png");
res = await call("PUT", "/users/me/avatar", form);
check("non-image rejected despite image content-type", res.status === 415, String(res.status));

form = new FormData();
form.append("file", new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: "image/png" }), "big.png");
res = await call("PUT", "/users/me/avatar", form);
check("avatar over 5 MB rejected", res.status === 413, String(res.status));

const avatarKey = sql(`select "avatarStorageKey" from "User" where id='${me.id}'`);
me = await (await call("DELETE", "/users/me/avatar")).json();
check("avatar removed", me.avatarUrl === null);
check("avatar file deleted", !existsSync(path.join(STORAGE_DIR, avatarKey)));

// email change: approve from old address, then verify new
const newEmail = `um-profile-new-${stamp}@example.com`;
offset = readFileSync(LOG, "utf8").length;
res = await fetch(`${API}/api/auth/change-email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ORIGIN, cookie },
  body: JSON.stringify({ newEmail, callbackURL: `${ORIGIN}/settings/account` }),
});
check("change-email request accepted", res.status === 200, String(res.status));
const log1 = await waitForLink(offset, /To: um-profile-\d+@example\.com\nSubject: Approve your Songverse email change[\s\S]*?https?:\/\/[^\s]+?\/api\/auth\/verify-email\?token=[^\s]+/);
check("approval goes to the OLD address", log1.includes(`To: ${email}`));
check("email unchanged before approval", sql(`select email from "User" where id='${me.id}'`) === email);

offset = readFileSync(LOG, "utf8").length;
await fetch(log1.match(verifyLink)[0], { redirect: "manual", headers: { cookie } });
const log2 = await waitForLink(offset, /To: um-profile-new-\d+@example\.com\nSubject: Confirm your new Songverse email[\s\S]*?https?:\/\/[^\s]+?\/api\/auth\/verify-email\?token=[^\s]+/);
check("verification goes to the NEW address", log2.includes(`To: ${newEmail}`));
check("email still unchanged until new address verified", sql(`select email from "User" where id='${me.id}'`) === email);

await fetch(log2.match(verifyLink)[0], { redirect: "manual", headers: { cookie } });
check("email changed after verifying new address", sql(`select email from "User" where id='${me.id}'`) === newEmail);

finish();
